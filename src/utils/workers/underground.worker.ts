/**
 * The tunnel worker: its own thread, because one chunk is 100–400ms and the dressing queue awaits one
 * task at a time. It ALWAYS answers a build (null on a throw) for the same reason.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "BUILD_UNDERGROUND", id, bounds: { minX, minZ, maxX, maxZ }, style: "cave" | "sewer", biomeId }
 *   IN:  { type: "CAVE_MOUTHS", id, area: { minX, minZ, maxX, maxZ } }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "UNDERGROUND_RESULT", id, chunk: UndergroundChunk | null }   (typed arrays transferred)
 *   OUT: { type: "UNDERGROUND_RESULT", id, mouths: MouthPiece[] }
 */

import { caveBiomeIds } from "./biomeFlags";
import { buildUndergroundChunk } from "./underground/chunkMesh";
import { caveMouthsNear } from "./underground/systems";
import type { MouthPiece, UndergroundChunk } from "./underground/types";
import { DomainConfig, initCompute } from "./vertexCompute";

let initialized = false;

const transferables = (chunk: UndergroundChunk): Transferable[] => {
  const out: Transferable[] = [chunk.mesh.positions.buffer, chunk.mesh.normals.buffer, chunk.mesh.colors.buffer, chunk.mesh.daylight.buffer, chunk.mesh.indices.buffer];
  for (const c of chunk.colliders) out.push(c.vertices.buffer, c.indices.buffer);
  if (chunk.liquid) out.push(chunk.liquid.positions.buffer, chunk.liquid.indices.buffer);
  if (chunk.patch) for (const value of Object.values(chunk.patch)) out.push((value as Float32Array).buffer);
  return out;
};

self.onmessage = (e: MessageEvent) => {
  const { type, id } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "BUILD_UNDERGROUND") {
    let chunk: UndergroundChunk | null = null;
    if (initialized) {
      try {
        chunk = buildUndergroundChunk(e.data.bounds, e.data.style, e.data.biomeId);
      } catch (err) {
        console.error("underground.worker: chunk build failed", err);
        chunk = null;
      }
    }
    (self as any).postMessage({ type: "UNDERGROUND_RESULT", id, chunk }, chunk ? transferables(chunk) : []);
    return;
  }

  if (type === "CAVE_MOUTHS") {
    let mouths: MouthPiece[] = [];
    if (initialized) {
      try {
        const seen = new Set<string>();
        for (const m of caveMouthsNear(caveBiomeIds(), e.data.area, 0)) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          mouths.push(m);
        }
      } catch (err) {
        console.error("underground.worker: mouth fetch failed", err);
        mouths = [];
      }
    }
    (self as any).postMessage({ type: "UNDERGROUND_RESULT", id, mouths });
    return;
  }

  console.error(`underground.worker: unknown message type "${type}"`);
  (self as any).postMessage({ type: "UNDERGROUND_RESULT", id, chunk: null });
};
