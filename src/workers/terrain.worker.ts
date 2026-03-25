/**
 * Terrain chunk computation worker.
 *
 * Receives vertex positions for a chunk, computes heights + shader attributes
 * using the inlined vertex pipeline (noise, voronoi, biome heights, city grid),
 * and returns Float32Array buffers as transferables.
 *
 * Messages:
 *   IN:  { type: "INIT", config: WorldConfig }
 *   IN:  { type: "BUILD_CHUNK", id: number, vertexX: Float32Array, vertexY: Float32Array, offsetX: number, offsetZ: number }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "CHUNK_BUILT", id, heights, biomeIds, distBiome, distRegion, distRoad }
 */

import { WorldConfig, initCompute, computeVertexData } from "./vertexCompute";

let initialized = false;

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as WorldConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "BUILD_CHUNK") {
    if (!initialized) {
      (self as any).postMessage({ type: "ERROR", error: "Worker not initialized" });
      return;
    }

    const { id, vertexX, vertexY, offsetX, offsetZ } = e.data;
    const count: number = vertexX.length;

    const heights = new Float32Array(count);
    const biomeIds = new Float32Array(count);
    const distBiome = new Float32Array(count);
    const distRegion = new Float32Array(count);
    const distRoad = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const result = computeVertexData(vertexX[i] + offsetX, -vertexY[i] + offsetZ);
      heights[i] = result.height;
      biomeIds[i] = result.biomeId;
      distBiome[i] = result.distanceToBiomeBoundaryCenter;
      distRegion[i] = result.distanceToRiverCenter;
      distRoad[i] = result.distanceToRoadCenter;
    }

    (self as any).postMessage(
      { type: "CHUNK_BUILT", id, heights, biomeIds, distBiome, distRegion, distRoad },
      [heights.buffer, biomeIds.buffer, distBiome.buffer, distRegion.buffer, distRoad.buffer]
    );
  }
};
