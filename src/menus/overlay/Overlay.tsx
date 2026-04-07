import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import { voronoi } from "../../utils/voronoi/voronoi";
import { useGameContext } from "../../context/GameContext";
import { useDevMode } from "../../context/DevContext";
import { WORLD_REGIONS } from "../../world/world";
import { getOrCreateLeftColumn } from "./overlayContainer";
const BIOME_POLL_INTERVAL = 1; // seconds

const GRAPH_WIDTH = 120;
const GRAPH_HEIGHT = 30;
const GRAPH_HISTORY = GRAPH_WIDTH; // one sample per pixel

const LABELS = ["FPS:     ", "MS:      ", "MB:      ", "Pos:     ", "Biome:   ", "Render:  ", "Terrain: "];

// indices into spans array
const I_FPS = 0;
const I_MS = 1;
const I_MB = 2;
const I_POS = 3;
const I_BIOME = 4;
const I_RENDER = 5;
const I_TERRAIN = 6;

// Graph indices (FPS, MS, MB)
const GRAPH_COLORS = ["#0f0", "#0ff", "#f0f"];
const GRAPH_MAX_DEFAULTS = [120, 33, 512]; // FPS caps at 120, MS at 33ms (~30fps), MB at 512

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
  const { progress, terrain_loaded } = useGameContext();

  const spans = useRef<HTMLSpanElement[]>([]);
  const graphs = useRef<{ ctx: CanvasRenderingContext2D; history: number[] }[]>([]);

  const frames = useRef(0);
  const elapsed = useRef(0);
  const lastFps = useRef(0);
  const lastMs = useRef(0);
  const biomePoll = useRef(0);
  const currentBiome = useRef("...");

  // Disable per-render auto-reset so gl.info accumulates stats across all
  // render passes (portal + main). We manually reset once per frame below.
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
    const createdGraphs: { ctx: CanvasRenderingContext2D; history: number[] }[] = [];

    LABELS.forEach((label, i) => {
      if (i > 0) container.appendChild(document.createTextNode("\n"));
      container.appendChild(document.createTextNode(label));
      const span = document.createElement("span");
      container.appendChild(span);
      createdSpans.push(span);

      // Add graph canvas after FPS, MS, MB rows
      if (i <= I_MB) {
        const g = createGraph();
        container.appendChild(g.canvas);
        createdGraphs.push({ ctx: g.ctx, history: g.history });
      }
    });

    spans.current = createdSpans;
    graphs.current = createdGraphs;
    column.appendChild(container);

    return () => {
      container.remove();
    };
  }, []);

  useFrame((_, delta) => {
    // Capture accumulated render stats from all previous frame's render passes
    // (portal + main), then reset for the next frame's accumulation.
    const renderCalls = gl.info.render.calls;
    const renderTris = gl.info.render.triangles;
    gl.info.reset();

    const s = spans.current;
    const g = graphs.current;
    if (s.length === 0) return;

    const ms = delta * 1000;
    lastMs.current = ms;

    // FPS (rolling average over 0.5s)
    frames.current++;
    elapsed.current += delta;
    if (elapsed.current >= 0.5) {
      lastFps.current = Math.round(frames.current / elapsed.current);
      frames.current = 0;
      elapsed.current = 0;
    }

    // Memory
    const mem = (performance as any).memory;
    const mb = mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) : "N/A";

    // Biome polling
    biomePoll.current += delta;
    if (biomePoll.current >= BIOME_POLL_INTERVAL) {
      biomePoll.current = 0;
      const pos = camera.position;
      voronoi
        .create({
          seed: "123",
          currentVertex: new THREE.Vector2(pos.x, pos.z),
          gridSize: 500,
          regionGridSize: 2500,
          regions: WORLD_REGIONS,
        })
        .then((result: any) => {
          currentBiome.current = result.biome?.name ?? "???";
        });
    }

    // Update text
    s[I_FPS].textContent = String(lastFps.current);
    s[I_MS].textContent = `${ms.toFixed(1)}`;
    s[I_MB].textContent = typeof mb === "string" ? mb : String(mb);
    const p = camera.position;
    s[I_POS].textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    s[I_BIOME].textContent = currentBiome.current;
    s[I_RENDER].textContent = `${renderCalls} draws, ${renderTris} tris`;
    s[I_TERRAIN].textContent = terrain_loaded ? "loaded" : `${Math.round(progress * 100)}%`;

    // Update graphs
    if (g.length >= 3) {
      const values = [lastFps.current, ms, mem ? mem.usedJSHeapSize / 1048576 : 0];
      for (let i = 0; i < 3; i++) {
        const hist = g[i].history;
        hist.push(values[i]);
        if (hist.length > GRAPH_HISTORY) hist.shift();
        drawGraph(g[i].ctx, hist, GRAPH_MAX_DEFAULTS[i], GRAPH_COLORS[i]);
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
