/**
 * Dressing placement worker: every dressing enumerator (the name → function table in
 * objects/dressing/enumerators.ts), plus two point queries that share its thread and config.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "ENUMERATE",     id, name: DressingEnumeratorName, bounds: DressingBounds, args }
 *   IN:  { type: "VERTEX_SAMPLE", id, x, z } (single padded height sample — Player backstop)
 *   IN:  { type: "PLACE_INFO",    id, x, z } (region/biome + sky weights + address cell)
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "DRESSING_RESULT", id, points }
 */

import { computeVertexData, getPlaceInfo, initCompute, DomainConfig } from "./vertexCompute";
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

  // A flatten-tile miss costs 30-70ms — the Player confirms its backstop here instead of on the main thread.
  if (type === "VERTEX_SAMPLE") {
    // biomeSdf is a shared scratch buffer and not what a sample consumer needs.
    reply(id, [{ ...computeVertexData(e.data.x, e.data.z), biomeSdf: undefined }]);
    return;
  }

  if (type === "PLACE_INFO") {
    reply(id, [getPlaceInfo(e.data.x, e.data.z)]);
    return;
  }

  console.error(`dressing.worker: unknown message type "${type}"`);
  reply(id, []);
};
