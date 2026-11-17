/**
 * The tunnel worker: its own thread, because one chunk is 100–400ms and the dressing queue awaits one
 * task at a time. It ALWAYS answers a build (null on a throw) for the same reason.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "BUILD_UNDERGROUND", id, bounds: { minX, minZ, maxX, maxZ }, style: "cave" | "sewer", biomeId }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "UNDERGROUND_RESULT", id, chunk: UndergroundChunk | null }   (typed arrays transferred)
 */

import { buildUndergroundChunk } from "../../generation/underground/chunks";
import type { UndergroundChunk } from "../../generation/underground/types";
import { DomainConfig, initCompute } from "../../generation";

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

  console.error(`underground.worker: unknown message type "${type}"`);
  (self as any).postMessage({ type: "UNDERGROUND_RESULT", id, chunk: null });
};
