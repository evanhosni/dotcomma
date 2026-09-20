import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import { voronoi } from "../../utils/voronoi/voronoi";
import { useGameContext } from "../../context/GameContext";
import { useDevContext } from "../../context/DevContext";
import { getActiveRegions, getTerrainParams } from "../../world/domains/utils";
import { getOrCreateLeftColumn } from "./overlayContainer";
const BIOME_POLL_INTERVAL = 1; // seconds

const GRAPH_WIDTH = 120;
const GRAPH_HEIGHT = 30;
const GRAPH_HISTORY = GRAPH_WIDTH; // one sample per pixel
/** Frames between DOM/canvas redraws (sampling itself runs every frame). */
const UI_REDRAW_INTERVAL = 4;

const SPIKE_RESET_KEY = "Backspace";

// Fixed column widths (monospace + white-space:pre) so a changing digit count never shifts the row.
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

const I_FPS = 0;
const I_MS = 1;
const I_MEM = 2;
const I_POS = 3;
const I_BIOME = 4;
const I_RENDER = 5;
const I_TERRAIN = 6;

// Mem graphs the live geometry count: pooled terrain chunks hold steady, so an upward drift is a leak.
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

const OverlayHUD = () => {
  const { gl, camera } = useThree();
  const { progress, terrainLoaded } = useGameContext();

  const spans = useRef<HTMLSpanElement[]>([]);
  const avgSpans = useRef<HTMLSpanElement[]>([]);
  const spikeSpans = useRef<HTMLSpanElement[]>([]);
  const graphs = useRef<{ ctx: CanvasRenderingContext2D; history: number[] }[]>([]);

  const frames = useRef(0);
  const elapsed = useRef(0);
  const lastFps = useRef(0);
  const lastMs = useRef(0);
  const biomePoll = useRef(0);
  const currentBiome = useRef("...");

  const avgFrames = useRef(0);
  const avgTime = useRef(0);
  const wasActive = useRef(false);
  const uiFrame = useRef(0);

  // Held until Backspace. FPS = worst 0.5s window, MS = worst SINGLE frame — not reciprocals.
  const minFps = useRef(Infinity);
  const maxMs = useRef(0);
  const fpsWindowClean = useRef(false);

  const peakGeometries = useRef(0);
  const peakTextures = useRef(0);
  const memGraphMax = useRef(GRAPH_MAX_DEFAULTS[I_MEM]);

  // gl.info must accumulate across all render passes; reset manually once per frame below.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== SPIKE_RESET_KEY) return;
      minFps.current = Infinity;
      maxMs.current = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    const createdGraphs: { ctx: CanvasRenderingContext2D; history: number[] }[] = [];

    LABELS.forEach((label, i) => {
      if (i > 0) container.appendChild(document.createTextNode("\n"));
      container.appendChild(document.createTextNode(label));
      const span = document.createElement("span");
      container.appendChild(span);
      createdSpans.push(span);

      if (i <= I_MEM) {
        const avg = document.createElement("span");
        avg.style.color = "rgba(0,255,0,0.55)";
        container.appendChild(avg);
        createdAvgSpans.push(avg);
      }

      if (i <= I_MS) {
        const spike = document.createElement("span");
        spike.style.color = "#f44";
        container.appendChild(spike);
        createdSpikeSpans.push(spike);
      }

      if (i <= I_MEM) {
        const g = createGraph();
        container.appendChild(g.canvas);
        createdGraphs.push({ ctx: g.ctx, history: g.history });
      }
    });

    spans.current = createdSpans;
    avgSpans.current = createdAvgSpans;
    spikeSpans.current = createdSpikeSpans;
    graphs.current = createdGraphs;
    column.appendChild(container);

    return () => {
      container.remove();
    };
  }, []);

  useFrame((_, delta) => {
    const renderCalls = gl.info.render.calls;
    const renderTris = gl.info.render.triangles;
    gl.info.reset();

    const s = spans.current;
    const g = graphs.current;
    if (s.length === 0) return;

    const ms = delta * 1000;
    lastMs.current = ms;

    // Sampling gate: loaded, tab active, AND the previous frame active too (the
    // frame after regaining focus has a delta spanning the whole inactive period).
    const isActive = document.visibilityState === "visible" && document.hasFocus();
    const sampling = terrainLoaded && isActive && wasActive.current;

    frames.current++;
    elapsed.current += delta;
    if (!sampling) fpsWindowClean.current = false;

    if (elapsed.current >= 0.5) {
      lastFps.current = Math.round(frames.current / elapsed.current);
      if (fpsWindowClean.current && lastFps.current < minFps.current) {
        minFps.current = lastFps.current;
      }
      frames.current = 0;
      elapsed.current = 0;
      fpsWindowClean.current = true;
    }
    if (sampling && ms > maxMs.current) maxMs.current = ms;

    const geometries = gl.info.memory.geometries;
    const textures = gl.info.memory.textures;
    const programs = gl.info.programs?.length ?? 0;
    if (geometries > peakGeometries.current) peakGeometries.current = geometries;
    if (textures > peakTextures.current) peakTextures.current = textures;
    if (geometries > memGraphMax.current) memGraphMax.current = geometries;

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
            currentVertex: { x: pos.x, z: pos.z },
            gridSize: params.gridSize,
            regionGridSize: params.regionGridSize,
            regions,
          })
          .then((result: any) => {
            currentBiome.current = result.biome?.name ?? "???";
          });
      }
    }

    if (sampling) {
      avgFrames.current++;
      avgTime.current += delta;
    }
    wasActive.current = isActive;

    // Sampling stays per-frame; the DOM/canvas writes were measurable in the numbers they report.
    if (uiFrame.current++ % UI_REDRAW_INTERVAL !== 0) return;

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
    if (sp.length === 2) {
      sp[I_FPS].textContent = `   low ${pad(minFps.current < Infinity ? minFps.current : "--", W_FPS)}`;
      sp[I_MS].textContent = `   high ${pad(maxMs.current > 0 ? maxMs.current.toFixed(1) : "--", W_MS)}`;
    }

    s[I_FPS].textContent = pad(lastFps.current, W_FPS);
    s[I_MS].textContent = pad(ms.toFixed(1), W_MS);
    s[I_MEM].textContent =
      `${pad(geometries, W_GEO)} geo,${pad(textures, W_TEX)} tex,${pad(programs, W_PROG)} prog`;
    const p = camera.position;
    s[I_POS].textContent =
      `${pad(p.x.toFixed(1), W_POS)},${pad(p.y.toFixed(1), W_POS)},${pad(p.z.toFixed(1), W_POS)}`;
    s[I_BIOME].textContent = currentBiome.current;
    s[I_RENDER].textContent = `${pad(renderCalls, W_DRAWS)} draws,${pad(renderTris, W_TRIS)} tris`;
    s[I_TERRAIN].textContent = terrainLoaded ? "loaded" : `${Math.round(progress * 100)}%`;

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
  const { devMode } = useDevContext();
  if (!devMode) return null;
  return <OverlayHUD />;
};
