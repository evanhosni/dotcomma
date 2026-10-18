/**
 * Dressing placement worker: every dressing enumerator (the name → function table in
 * objects/dressing/enumerators.ts), plus two point queries that share its thread and config.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "ENUMERATE",     id, name: DressingEnumeratorName, bounds: DressingBounds, args }
 *   IN:  { type: "VERTEX_SAMPLE", id, x, z, raw? } (single height sample, padded or raw — the Player's backstop and water probe)
 *   IN:  { type: "PLACE_INFO",    id, x, z } (region/biome + sky weights + address cell)
 *   IN:  { type: "SURFACE",       id, x, z, feetY } (the movement modifiers under a capsule — the Player's snow wading and traction)
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "DRESSING_RESULT", id, points }
 */

import { computeVertexData, computeVertexDataRaw, getPlaceInfo, initCompute, surfaceModifiersAt, DomainConfig } from "./vertexCompute";
import { isDressingEnumerator, runDressingEnumerator } from "../../objects/dressing/enumerators";

let initialized = false;

const reply = (id: number, points: unknown[]): void => {
  (self as any).postMessage({ type: "DRESSING_RESULT", id, points });
};

self.onmessage = (e: MessageEvent) => {
  const { type, id } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (!initialized) {
    reply(id, []);
    return;
  }

  if (type === "ENUMERATE") {
    const { name, bounds, args } = e.data;
    if (!isDressingEnumerator(name)) {
      console.error(`dressing.worker: no enumerator "${name}" (objects/dressing/enumerators.ts)`);
      reply(id, []);
      return;
    }
    reply(id, runDressingEnumerator(name, bounds, args));
    return;
  }

  // The Player's height and water samples land here, never on the main thread: a flatten-tile miss
  // costs 30–70ms, and even the raw path's first touch of a cell builds its river list and road network
  // (58ms + 12ms measured mid-flight, PERFORMANCE.md).
  if (type === "VERTEX_SAMPLE") {
    const vd = e.data.raw ? computeVertexDataRaw(e.data.x, e.data.z) : computeVertexData(e.data.x, e.data.z);
    // biomeSdf is a shared scratch buffer and not what a sample consumer needs.
    reply(id, [{ ...vd, biomeSdf: undefined }]);
    return;
  }

  if (type === "PLACE_INFO") {
    reply(id, [getPlaceInfo(e.data.x, e.data.z)]);
    return;
  }

  // The snow reads its lattice through the full pipeline; its first touch of a mountain cell
  // generates the cell's caves (~250ms), which no stepping thread can afford (physics/DECISIONS.md).
  if (type === "SURFACE") {
    reply(id, [surfaceModifiersAt(e.data.x, e.data.z, e.data.feetY)]);
    return;
  }

  console.error(`dressing.worker: unknown message type "${type}"`);
  reply(id, []);
};
