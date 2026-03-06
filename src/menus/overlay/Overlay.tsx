import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import { voronoi } from "../../utils/voronoi/voronoi";
import { useGameContext } from "../../context/GameContext";
import { Dimension } from "../../world/types";

const ENABLED = new URLSearchParams(window.location.search).has("overlay");
const BIOME_POLL_INTERVAL = 1; // seconds

interface OverlayProps {
  dimension: Dimension;
}

const LABELS = ["FPS:     ", "Pos:     ", "Biome:   ", "Render:  ", "Terrain: "];

const OverlayHUD = ({ dimension }: OverlayProps) => {
  const { gl, camera } = useThree();
  const { progress, terrain_loaded } = useGameContext();

  const spans = useRef<HTMLSpanElement[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const frames = useRef(0);
  const elapsed = useRef(0);
  const lastFps = useRef(0);
  const biomePoll = useRef(0);
  const currentBiome = useRef("...");

  // Build the DOM overlay imperatively (outside R3F's reconciler)
  useEffect(() => {
    const target = document.getElementById("dotcomma");
    if (!target) return;

    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;bottom:12px;left:12px;z-index:1000;background:rgba(0,0,0,0.6);" +
      "color:#0f0;font-family:'Kode Mono','Courier New',Courier,monospace;font-size:12px;" +
      "line-height:1.5;padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre;";

    const createdSpans: HTMLSpanElement[] = [];
    LABELS.forEach((label, i) => {
      if (i > 0) container.appendChild(document.createTextNode("\n"));
      container.appendChild(document.createTextNode(label));
      const span = document.createElement("span");
      container.appendChild(span);
      createdSpans.push(span);
    });

    spans.current = createdSpans;
    containerRef.current = container;
    target.appendChild(container);

    return () => {
      target.removeChild(container);
    };
  }, []);

  useFrame((_, delta) => {
    const s = spans.current;
    if (s.length === 0) return;

    // FPS
    frames.current++;
    elapsed.current += delta;
    if (elapsed.current >= 0.5) {
      lastFps.current = Math.round(frames.current / elapsed.current);
      frames.current = 0;
      elapsed.current = 0;
    }

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
          regions: dimension.regions,
        })
        .then((result: any) => {
          currentBiome.current = result.biome?.name ?? "???";
        });
    }

    // Update DOM
    s[0].textContent = String(lastFps.current);
    const p = camera.position;
    s[1].textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    s[2].textContent = currentBiome.current;
    const info = gl.info.render;
    s[3].textContent = `${info.calls} draws, ${info.triangles} tris`;
    s[4].textContent = terrain_loaded ? "loaded" : `${Math.round(progress * 100)}%`;
  });

  return null;
};

export const Overlay = ({ dimension }: OverlayProps) => {
  if (!ENABLED) return null;
  return <OverlayHUD dimension={dimension} />;
};
