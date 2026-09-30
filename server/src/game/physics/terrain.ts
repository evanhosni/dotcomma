import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../../src/world/terrain/lodConfig";

/**
 * The client's LOD1 collider EXACTLY (terrain.worker.ts → generateColliders):
 * same fround'd local grid, same PlaneGeometry z-flip, same column-major
 * layout, body at the chunk CENTER — bit-identical ground to the player's.
 * Only LOD1: the resolution the player stands on and the slope tuning was
 * measured at.
 */

export const TERRAIN_CHUNK_SIZE = CHUNK_SIZE;
export const TERRAIN_SEGMENTS = LOD1_SEGMENTS;
const N = TERRAIN_SEGMENTS + 1;
const HALF = TERRAIN_CHUNK_SIZE / 2;

export const chunkIndex = (v: number): number => Math.floor(v / TERRAIN_CHUNK_SIZE);
export const chunkCenter = (g: number): number => g * TERRAIN_CHUNK_SIZE + HALF;
export const chunkKey = (gx: number, gz: number): string => `${gx}_${gz}`;

// fround keeps heights bit-identical to the float32 positions the client samples.
const localX = new Float64Array(N);
const localY = new Float64Array(N);
for (let i = 0; i < N; i++) {
  localX[i] = Math.fround((i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE - HALF);
  localY[i] = Math.fround(-(i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE + HALF);
}

export const vertexWorld = (gx: number, gz: number, ix: number, iz: number): { x: number; z: number } => ({
  x: chunkCenter(gx) + localX[ix],
  z: chunkCenter(gz) - localY[iz],
});

/** The collider surface is exact at a vertex. */
export const snapToVertex = (x: number, z: number): { x: number; z: number } => {
  const s = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS;
  return { x: Math.round(x / s) * s, z: Math.round(z / s) * s };
};

/** Column-major, exactly what the client's terrain worker hands generateColliders. */
export const sampleChunkHeights = (gx: number, gz: number): Float32Array => {
  const heights = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) sampleChunkRow(gx, gz, iz, heights);
  return heights;
};

/** A row is the unit of work for budgeted incremental chunk builds. */
export const TERRAIN_ROWS = N;
export const sampleChunkRow = (gx: number, gz: number, iz: number, heights: Float32Array): void => {
  const cx = chunkCenter(gx);
  const wz = -localY[iz] + chunkCenter(gz);
  for (let ix = 0; ix < N; ix++) {
    heights[ix * N + iz] = computeVertexData(localX[ix] + cx, wz).height;
  }
};
