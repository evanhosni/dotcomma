import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { useDevContext } from "../../context/DevContext";
import { useGameContext } from "../../context/GameContext";
import { getPlaceInfo } from "../../objects/dressing/dressingWorker";
import { getAllBiomes } from "../../utils/utils";
import { getActiveRegions } from "../../world/domains/utils";
import { getOrCreateLeftColumn } from "./overlayContainer";
import { PANEL_CSS } from "./styles";

const BIOME_POLL_INTERVAL_S = 1;
/** FPS is counted over windows this long. */
const FPS_WINDOW_S = 0.5;

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

interface Graph {
  ctx: CanvasRenderingContext2D;
  history: number[];
}

function createGraph(): Graph & { canvas: HTMLCanvasElement } {
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

interface StatsPanel {
  container: HTMLDivElement;
  /** One value span per LABELS row. */
  spans: HTMLSpanElement[];
  /** Running averages (FPS, MS) and the peak counts (Mem). */
  avgSpans: HTMLSpanElement[];
  /** Held worst values (FPS low, MS high). */
  spikeSpans: HTMLSpanElement[];
  /** FPS, MS, Mem. */
  graphs: Graph[];
}

/** The panel's DOM: a label + value per row, the extra avg/spike spans and a graph under the first rows. */
const createStatsPanel = (): StatsPanel => {
  const container = document.createElement("div");
  container.style.cssText = "order:1;" + PANEL_CSS;
  const panel: StatsPanel = { container, spans: [], avgSpans: [], spikeSpans: [], graphs: [] };

  LABELS.forEach((label, i) => {
    if (i > 0) container.appendChild(document.createTextNode("\n"));
    container.appendChild(document.createTextNode(label));
    const span = document.createElement("span");
    container.appendChild(span);
    panel.spans.push(span);

    if (i <= I_MEM) {
      const avg = document.createElement("span");
      avg.style.color = "rgba(0,255,0,0.55)";
      container.appendChild(avg);
      panel.avgSpans.push(avg);
    }

    if (i <= I_MS) {
      const spike = document.createElement("span");
      spike.style.color = "#f44";
      container.appendChild(spike);
      panel.spikeSpans.push(spike);
    }

    if (i <= I_MEM) {
      const g = createGraph();
      container.appendChild(g.canvas);
      panel.graphs.push({ ctx: g.ctx, history: g.history });
    }
  });
  return panel;
};

/** Everything the HUD measures, mutated every frame. */
interface FrameStats {
  /** The current FPS window. */
  windowFrames: number;
  windowElapsed: number;
  /** Set when a whole window was sampled — only those may lower `minFps`. */
  windowClean: boolean;
  lastFps: number;
  /** Totals over every sampled frame, for the averages. */
  avgFrames: number;
  avgTime: number;
  /** Held until SPIKE_RESET_KEY. FPS = worst window, MS = worst SINGLE frame — not reciprocals. */
  minFps: number;
  maxMs: number;
  wasActive: boolean;
  peakGeometries: number;
  peakTextures: number;
  memGraphMax: number;
  placePollElapsed: number;
  /** "region/biome" under the camera. */
  place: string;
  uiFrame: number;
}

const createFrameStats = (): FrameStats => ({
  windowFrames: 0,
  windowElapsed: 0,
  windowClean: false,
  lastFps: 0,
  avgFrames: 0,
  avgTime: 0,
  minFps: Infinity,
  maxMs: 0,
  wasActive: false,
  peakGeometries: 0,
  peakTextures: 0,
  memGraphMax: GRAPH_MAX_DEFAULTS[I_MEM],
  placePollElapsed: 0,
  place: "...",
  uiFrame: 0,
});

/** Counts the frame into the FPS window, the averages and the held spikes (only `sampling` frames count). */
const sampleFrameTiming = (stats: FrameStats, delta: number, ms: number, sampling: boolean): void => {
  stats.windowFrames++;
  stats.windowElapsed += delta;
  if (!sampling) stats.windowClean = false;

  if (stats.windowElapsed >= FPS_WINDOW_S) {
    stats.lastFps = Math.round(stats.windowFrames / stats.windowElapsed);
    if (stats.windowClean && stats.lastFps < stats.minFps) {
      stats.minFps = stats.lastFps;
    }
    stats.windowFrames = 0;
    stats.windowElapsed = 0;
    stats.windowClean = true;
  }
  if (sampling && ms > stats.maxMs) stats.maxMs = ms;
};

/** Asks the dressing worker, once per BIOME_POLL_INTERVAL_S, which region and biome the camera is in. */
const pollPlace = (stats: FrameStats, delta: number, position: THREE.Vector3): void => {
  stats.placePollElapsed += delta;
  if (stats.placePollElapsed < BIOME_POLL_INTERVAL_S) return;
  stats.placePollElapsed = 0;
  if (getActiveRegions().length === 0) return;
  getPlaceInfo(position.x, position.z)
    .then((place) => {
      if (!place) return;
      const active = getActiveRegions();
      const biome = getAllBiomes(active).find((b) => b.id === place.biomeId);
      const region = active.find((r) => r.id === place.regionId);
      stats.place = `${region?.name ?? "?"}/${biome?.name ?? "???"}`;
    })
    .catch(() => undefined);
};

interface FrameReadings {
  ms: number;
  geometries: number;
  textures: number;
  programs: number;
  renderCalls: number;
  renderTris: number;
  position: THREE.Vector3;
  terrain: string;
}

const writeStatsPanel = (panel: StatsPanel, stats: FrameStats, r: FrameReadings): void => {
  const a = panel.avgSpans;
  if (stats.avgTime > 0) {
    const avgFps = stats.avgFrames / stats.avgTime;
    const avgMs = (stats.avgTime / stats.avgFrames) * 1000;
    a[I_FPS].textContent = `   avg ${pad(avgFps.toFixed(1), W_FPS_AVG)}`;
    a[I_MS].textContent = `   avg ${pad(avgMs.toFixed(1), W_MS)}`;
  } else {
    a[I_FPS].textContent = `   avg ${pad("--", W_FPS_AVG)}`;
    a[I_MS].textContent = `   avg ${pad("--", W_MS)}`;
  }
  a[I_MEM].textContent = `   peak ${pad(stats.peakGeometries, W_GEO)} /${pad(stats.peakTextures, W_TEX)}`;

  const sp = panel.spikeSpans;
  sp[I_FPS].textContent = `   low ${pad(stats.minFps < Infinity ? stats.minFps : "--", W_FPS)}`;
  sp[I_MS].textContent = `   high ${pad(stats.maxMs > 0 ? stats.maxMs.toFixed(1) : "--", W_MS)}`;

  const s = panel.spans;
  s[I_FPS].textContent = pad(stats.lastFps, W_FPS);
  s[I_MS].textContent = pad(r.ms.toFixed(1), W_MS);
  s[I_MEM].textContent = `${pad(r.geometries, W_GEO)} geo,${pad(r.textures, W_TEX)} tex,${pad(r.programs, W_PROG)} prog`;
  const p = r.position;
  s[I_POS].textContent = `${pad(p.x.toFixed(1), W_POS)},${pad(p.y.toFixed(1), W_POS)},${pad(p.z.toFixed(1), W_POS)}`;
  s[I_BIOME].textContent = stats.place;
  s[I_RENDER].textContent = `${pad(r.renderCalls, W_DRAWS)} draws,${pad(r.renderTris, W_TRIS)} tris`;
  s[I_TERRAIN].textContent = r.terrain;

  const values = [stats.lastFps, r.ms, r.geometries];
  const maxes = [GRAPH_MAX_DEFAULTS[I_FPS], GRAPH_MAX_DEFAULTS[I_MS], stats.memGraphMax];
  for (let i = 0; i < 3; i++) {
    const hist = panel.graphs[i].history;
    hist.push(values[i]);
    if (hist.length > GRAPH_HISTORY) hist.shift();
    drawGraph(panel.graphs[i].ctx, hist, maxes[i], GRAPH_COLORS[i]);
  }
};

const StatsHud = () => {
  const { gl, camera } = useThree();
  const { progress, terrainLoaded } = useGameContext();
  const panelRef = useRef<StatsPanel | null>(null);
  const stats = useRef(createFrameStats()).current;

  // gl.info must accumulate across all render passes; reset manually once per frame below.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== SPIKE_RESET_KEY) return;
      stats.minFps = Infinity;
      stats.maxMs = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const panel = createStatsPanel();
    panelRef.current = panel;
    getOrCreateLeftColumn().appendChild(panel.container);

    return () => {
      panel.container.remove();
    };
  }, []);

  useFrame((_, delta) => {
    const renderCalls = gl.info.render.calls;
    const renderTris = gl.info.render.triangles;
    gl.info.reset();

    const panel = panelRef.current;
    if (!panel) return;

    const ms = delta * 1000;

    // Sampling gate: loaded, tab active, AND the previous frame active too (the
    // frame after regaining focus has a delta spanning the whole inactive period).
    const isActive = document.visibilityState === "visible" && document.hasFocus();
    const sampling = terrainLoaded && isActive && stats.wasActive;
    sampleFrameTiming(stats, delta, ms, sampling);

    const geometries = gl.info.memory.geometries;
    const textures = gl.info.memory.textures;
    const programs = gl.info.programs?.length ?? 0;
    if (geometries > stats.peakGeometries) stats.peakGeometries = geometries;
    if (textures > stats.peakTextures) stats.peakTextures = textures;
    if (geometries > stats.memGraphMax) stats.memGraphMax = geometries;

    pollPlace(stats, delta, camera.position);

    if (sampling) {
      stats.avgFrames++;
      stats.avgTime += delta;
    }
    stats.wasActive = isActive;

    // Sampling stays per-frame; the DOM/canvas writes were measurable in the numbers they report.
    if (stats.uiFrame++ % UI_REDRAW_INTERVAL !== 0) return;
    const terrain = terrainLoaded ? "loaded" : `${Math.round(progress * 100)}%`;
    writeStatsPanel(panel, stats, { ms, geometries, textures, programs, renderCalls, renderTris, position: camera.position, terrain });
  }, -1000);

  return null;
};

/** The devmode stats HUD (bottom-left column). Inside the canvas: it reads `gl.info` every frame. */
export const StatsOverlay = () => {
  const { devMode } = useDevContext();
  if (!devMode) return null;
  return <StatsHud />;
};
