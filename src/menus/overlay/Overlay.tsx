import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import { voronoi } from "../../utils/voronoi/voronoi";
import { useGameContext } from "../../context/GameContext";
import { useDevMode } from "../../context/DevContext";
import { getActiveRegions, getTerrainParams } from "../../world/domains/utils";
import { getOrCreateLeftColumn } from "./overlayContainer";
const BIOME_POLL_INTERVAL = 1; // seconds

const GRAPH_WIDTH = 120;
const GRAPH_HEIGHT = 30;
const GRAPH_HISTORY = GRAPH_WIDTH; // one sample per pixel

// A low/high spike is held for this long, then cleared so the readout tracks
// recent behavior instead of the worst thing that ever happened. A new record
// restarts the countdown.
const SPIKE_HOLD = 5; // seconds
const SPIKE_BAR_WIDTH = 36; // px

// Every numeric readout is padded to a fixed character width so that a value
// gaining or losing a digit never shifts what sits to its right (the font is
// monospace and the container is white-space:pre, so columns line up exactly).
// Values wider than their column simply push out rather than being truncated.
const W_FPS = 3;
const W_FPS_AVG = 5;
const W_MS = 6; // fits a 1000ms+ hitch
const W_GEO = 4;
const W_TEX = 3;
const W_PROG = 3;
const W_POS = 8;
const W_DRAWS = 4;
const W_TRIS = 7;

const pad = (value: string | number, width: number) => String(value).padStart(width);

const LABELS = ["FPS:     ", "MS:      ", "Mem:     ", "Pos:     ", "Biome:   ", "Render:  ", "Terrain: "];

// indices into spans array
const I_FPS = 0;
const I_MS = 1;
const I_MEM = 2;
const I_POS = 3;
const I_BIOME = 4;
const I_RENDER = 5;
const I_TERRAIN = 6;

// Graph indices (FPS, MS, Mem). Mem graphs the live geometry count against an
// auto-scaling ceiling — the pooled terrain chunks should hold steady, so an
// upward drift here is a geometry leak.
const GRAPH_COLORS = ["#0f0", "#0ff", "#f0f"];
const GRAPH_MAX_DEFAULTS = [120, 33, 64]; // FPS caps at 120, MS at 33ms (~30fps), Mem auto-grows from 64

function createGraph(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; history: number[] } {
  const canvas = document.createElement("canvas");
  canvas.width = GRAPH_WIDTH;
  canvas.height = GRAPH_HEIGHT;
  canvas.style.cssText = `display:block;width:${GRAPH_WIDTH}px;height:${GRAPH_HEIGHT}px;margin-top:2px;border-radius:2px;background:rgba(0,0,0,0.4);`;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx, history: [] };
}

function drawGraph(ctx: CanvasRenderingContext2D, history: number[], maxVal: number, color: string) {
  ctx.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

  ctx.beginPath();
  const len = history.length;
  const offset = GRAPH_WIDTH - len;
  for (let i = 0; i < len; i++) {
    const x = offset + i;
    const y = GRAPH_HEIGHT - Math.min(history[i] / maxVal, 1) * GRAPH_HEIGHT;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Countdown bar shown beside a spike value: full when the record was just set,
// empty when it is about to expire. Returns the fill element to size per frame.
function createSpikeBar(): { track: HTMLDivElement; fill: HTMLDivElement } {
  const track = document.createElement("div");
  track.style.cssText =
    `display:inline-block;vertical-align:middle;width:${SPIKE_BAR_WIDTH}px;height:5px;` +
    "margin-left:6px;border-radius:2px;background:rgba(255,68,68,0.18);overflow:hidden;visibility:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:100%;background:#f44;border-radius:2px;";
  track.appendChild(fill);
  return { track, fill };
}

const OverlayHUD = () => {
  const { gl, camera } = useThree();
  const { progress, terrain_loaded } = useGameContext();

  const spans = useRef<HTMLSpanElement[]>([]);
  const avgSpans = useRef<HTMLSpanElement[]>([]);
  const spikeSpans = useRef<HTMLSpanElement[]>([]);
  const spikeBars = useRef<{ track: HTMLDivElement; fill: HTMLDivElement }[]>([]);
  const graphs = useRef<{ ctx: CanvasRenderingContext2D; history: number[] }[]>([]);

  const frames = useRef(0);
  const elapsed = useRef(0);
  const lastFps = useRef(0);
  const lastMs = useRef(0);
  const biomePoll = useRef(0);
  const currentBiome = useRef("...");

  // Running averages — accumulate only after terrain loads (load-phase stutter
  // would skew benchmarks) and only while this tab is visible AND focused
  // (background tabs throttle rAF, producing faulty samples)
  const avgFrames = useRef(0);
  const avgTime = useRef(0);
  const wasActive = useRef(false);

  // Worst-case spikes over the same sampling window as the averages, each held
  // for SPIKE_HOLD seconds after it was last beaten. FPS tracks the worst 0.5s
  // window (a sustained dip); MS tracks the worst SINGLE frame (a one-frame
  // hitch), so the two are not reciprocals of each other.
  const minFps = useRef(Infinity);
  const minFpsAge = useRef(0);
  const maxMs = useRef(0);
  const maxMsAge = useRef(0);
  const fpsWindowClean = useRef(false);

  // Peak resource counts, and the auto-scaling ceiling for the memory graph
  const peakGeometries = useRef(0);
  const peakTextures = useRef(0);
  const memGraphMax = useRef(GRAPH_MAX_DEFAULTS[I_MEM]);

  // Disable per-render auto-reset so gl.info accumulates stats across all
  // render passes. We manually reset once per frame below.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);

  // Build the DOM overlay imperatively (outside R3F's reconciler)
  useEffect(() => {
    const column = getOrCreateLeftColumn();

    const container = document.createElement("div");
    container.style.cssText =
      "order:1;background:rgba(0,0,0,0.6);" +
      "color:#0f0;font-family:'Kode Mono','Courier New',Courier,monospace;font-size:12px;" +
      "line-height:1.5;padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre;";

    const createdSpans: HTMLSpanElement[] = [];
    const createdAvgSpans: HTMLSpanElement[] = [];
    const createdSpikeSpans: HTMLSpanElement[] = [];
    const createdSpikeBars: { track: HTMLDivElement; fill: HTMLDivElement }[] = [];
    const createdGraphs: { ctx: CanvasRenderingContext2D; history: number[] }[] = [];

    LABELS.forEach((label, i) => {
      if (i > 0) container.appendChild(document.createTextNode("\n"));
      container.appendChild(document.createTextNode(label));
      const span = document.createElement("span");
      container.appendChild(span);
      createdSpans.push(span);

      // Secondary readout to the right of the FPS, MS, Mem counters
      if (i <= I_MEM) {
        const avg = document.createElement("span");
        avg.style.color = "rgba(0,255,0,0.55)";
        container.appendChild(avg);
        createdAvgSpans.push(avg);
      }

      // Worst-case spike in red + its expiry bar (FPS and MS only — the memory
      // row's peak never expires, so it needs no countdown)
      if (i <= I_MS) {
        const spike = document.createElement("span");
        spike.style.color = "#f44";
        container.appendChild(spike);
        createdSpikeSpans.push(spike);

        const bar = createSpikeBar();
        container.appendChild(bar.track);
        createdSpikeBars.push(bar);
      }

      // Add graph canvas after FPS, MS, Mem rows
      if (i <= I_MEM) {
        const g = createGraph();
        container.appendChild(g.canvas);
        createdGraphs.push({ ctx: g.ctx, history: g.history });
      }
    });

    spans.current = createdSpans;
    avgSpans.current = createdAvgSpans;
    spikeSpans.current = createdSpikeSpans;
    spikeBars.current = createdSpikeBars;
    graphs.current = createdGraphs;
    column.appendChild(container);

    return () => {
      container.remove();
    };
  }, []);

  useFrame((_, delta) => {
    // Capture accumulated render stats from all previous frame's render passes
    // then reset for the next frame's accumulation.
    const renderCalls = gl.info.render.calls;
    const renderTris = gl.info.render.triangles;
    gl.info.reset();

    const s = spans.current;
    const g = graphs.current;
    if (s.length === 0) return;

    const ms = delta * 1000;
    lastMs.current = ms;

    // Sampling gate, shared by the averages and the spikes: the world must be
    // loaded and the tab active, and the previous frame must have been active
    // too (the frame right after regaining focus has a delta spanning the whole
    // inactive period)
    const isActive = document.visibilityState === "visible" && document.hasFocus();
    const sampling = terrain_loaded && isActive && wasActive.current;

    // FPS (rolling average over 0.5s)
    frames.current++;
    elapsed.current += delta;
    if (!sampling) fpsWindowClean.current = false;

    // Expire held spikes first, so a window closing this frame can immediately
    // set the next record
    if (sampling) {
      if (minFps.current < Infinity) {
        minFpsAge.current += delta;
        if (minFpsAge.current >= SPIKE_HOLD) {
          minFps.current = Infinity;
          minFpsAge.current = 0;
        }
      }
      if (maxMs.current > 0) {
        maxMsAge.current += delta;
        if (maxMsAge.current >= SPIKE_HOLD) {
          maxMs.current = 0;
          maxMsAge.current = 0;
        }
      }
    }

    if (elapsed.current >= 0.5) {
      lastFps.current = Math.round(frames.current / elapsed.current);
      if (fpsWindowClean.current && lastFps.current < minFps.current) {
        minFps.current = lastFps.current;
        minFpsAge.current = 0;
      }
      frames.current = 0;
      elapsed.current = 0;
      fpsWindowClean.current = true;
    }
    if (sampling && ms > maxMs.current) {
      maxMs.current = ms;
      maxMsAge.current = 0;
    }

    // Renderer resources — works in every browser, and unlike the JS heap these
    // actually track where a Three.js scene spends its memory
    const geometries = gl.info.memory.geometries;
    const textures = gl.info.memory.textures;
    const programs = gl.info.programs?.length ?? 0;
    if (geometries > peakGeometries.current) peakGeometries.current = geometries;
    if (textures > peakTextures.current) peakTextures.current = textures;
    if (geometries > memGraphMax.current) memGraphMax.current = geometries;

    // Biome polling
    biomePoll.current += delta;
    if (biomePoll.current >= BIOME_POLL_INTERVAL) {
      biomePoll.current = 0;
      const pos = camera.position;
      const regions = getActiveRegions();
      if (regions.length > 0) {
        const params = getTerrainParams();
        voronoi
          .create({
            seed: params.seed,
            currentVertex: new THREE.Vector2(pos.x, pos.z),
            gridSize: params.gridSize,
            regionGridSize: params.regionGridSize,
            regions,
          })
          .then((result: any) => {
            currentBiome.current = result.biome?.name ?? "???";
          });
      }
    }

    // Running averages, over the same sampling window as the spikes above
    if (sampling) {
      avgFrames.current++;
      avgTime.current += delta;
    }
    wasActive.current = isActive;

    const a = avgSpans.current;
    if (a.length === 3) {
      if (avgTime.current > 0) {
        const avgFps = avgFrames.current / avgTime.current;
        const avgMs = (avgTime.current / avgFrames.current) * 1000;
        a[I_FPS].textContent = `   avg ${pad(avgFps.toFixed(1), W_FPS_AVG)}`;
        a[I_MS].textContent = `   avg ${pad(avgMs.toFixed(1), W_MS)}`;
      } else {
        a[I_FPS].textContent = `   avg ${pad("--", W_FPS_AVG)}`;
        a[I_MS].textContent = `   avg ${pad("--", W_MS)}`;
      }
      a[I_MEM].textContent = `   peak ${pad(peakGeometries.current, W_GEO)} /${pad(peakTextures.current, W_TEX)}`;
    }

    const sp = spikeSpans.current;
    const bars = spikeBars.current;
    if (sp.length === 2) {
      const hasLow = minFps.current < Infinity;
      const hasHigh = maxMs.current > 0;
      sp[I_FPS].textContent = `   low ${pad(hasLow ? minFps.current : "--", W_FPS)}`;
      sp[I_MS].textContent = `   high ${pad(hasHigh ? maxMs.current.toFixed(1) : "--", W_MS)}`;
      bars[I_FPS].track.style.visibility = hasLow ? "visible" : "hidden";
      bars[I_MS].track.style.visibility = hasHigh ? "visible" : "hidden";
      if (hasLow) {
        bars[I_FPS].fill.style.width = `${Math.max(0, 1 - minFpsAge.current / SPIKE_HOLD) * 100}%`;
      }
      if (hasHigh) {
        bars[I_MS].fill.style.width = `${Math.max(0, 1 - maxMsAge.current / SPIKE_HOLD) * 100}%`;
      }
    }

    // Update text
    s[I_FPS].textContent = pad(lastFps.current, W_FPS);
    s[I_MS].textContent = pad(ms.toFixed(1), W_MS);
    s[I_MEM].textContent =
      `${pad(geometries, W_GEO)} geo,${pad(textures, W_TEX)} tex,${pad(programs, W_PROG)} prog`;
    const p = camera.position;
    s[I_POS].textContent =
      `${pad(p.x.toFixed(1), W_POS)},${pad(p.y.toFixed(1), W_POS)},${pad(p.z.toFixed(1), W_POS)}`;
    s[I_BIOME].textContent = currentBiome.current;
    s[I_RENDER].textContent = `${pad(renderCalls, W_DRAWS)} draws,${pad(renderTris, W_TRIS)} tris`;
    s[I_TERRAIN].textContent = terrain_loaded ? "loaded" : `${Math.round(progress * 100)}%`;

    // Update graphs
    if (g.length >= 3) {
      const values = [lastFps.current, ms, geometries];
      const maxes = [GRAPH_MAX_DEFAULTS[I_FPS], GRAPH_MAX_DEFAULTS[I_MS], memGraphMax.current];
      for (let i = 0; i < 3; i++) {
        const hist = g[i].history;
        hist.push(values[i]);
        if (hist.length > GRAPH_HISTORY) hist.shift();
        drawGraph(g[i].ctx, hist, maxes[i], GRAPH_COLORS[i]);
      }
    }
  }, -1000);

  return null;
};

export const Overlay = () => {
  const { devMode } = useDevMode();
  if (!devMode) return null;
  return <OverlayHUD />;
};
