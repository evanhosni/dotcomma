import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../../src/world/terrain/lodConfig";

/**
 * TERRAIN HEIGHTFIELD CHUNKS for the server physics world.
 *
 * Replicates the client's LOD1 collider EXACTLY (terrain.worker.ts →
 * TerrainRenderer.GenerateColliders): a 420u chunk sampled on a 97×97 grid
 * (4.375u spacing) with the same float32-rounded local coordinates, the same
 * PlaneGeometry z-flip, and the same column-major layout Rapier wants
 * (heights[ix * n + iz]), on a fixed body at the chunk CENTER. Same height
 * function (computeVertexData, flatten pads included), same grid → the server
 * stands on bit-identical ground to the player.
 *
 * Only LOD1 is replicated: it is the resolution the player always stands on
 * and the one the slope tuning was measured at.
 */

export const TERRAIN_CHUNK_SIZE = CHUNK_SIZE;
export const TERRAIN_SEGMENTS = LOD1_SEGMENTS;
const N = TERRAIN_SEGMENTS + 1;
const HALF = TERRAIN_CHUNK_SIZE / 2;

/** Chunk grid index containing a world coordinate. */
export const chunkIndex = (v: number): number => Math.floor(v / TERRAIN_CHUNK_SIZE);
/** World-space center of a chunk index (the fixed body's translation). */
export const chunkCenter = (g: number): number => g * TERRAIN_CHUNK_SIZE + HALF;
export const chunkKey = (gx: number, gz: number): string => `${gx}_${gz}`;

// Local plane-frame grid, identical to terrain.worker.ts (fround keeps the
// heights bit-identical to the float32 positions the client samples).
const localX = new Float64Array(N);
const localY = new Float64Array(N);
for (let i = 0; i < N; i++) {
  localX[i] = Math.fround((i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE - HALF);
  localY[i] = Math.fround(-(i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE + HALF);
}

/** World position of grid vertex (ix, iz) of chunk (gx, gz). */
export const vertexWorld = (gx: number, gz: number, ix: number, iz: number): { x: number; z: number } => ({
  x: chunkCenter(gx) + localX[ix],
  z: chunkCenter(gz) - localY[iz],
});

/** Nearest heightfield VERTEX to a world position (the surface is exact there). */
export const snapToVertex = (x: number, z: number): { x: number; z: number } => {
  const s = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS;
  return { x: Math.round(x / s) * s, z: Math.round(z / s) * s };
};

/** Column-major heights for Rapier's `ColliderDesc.heightfield(SEGMENTS,
 *  SEGMENTS, heights, {x: 420, y: 1, z: 420})` — the exact array the client's
 *  terrain worker hands GenerateColliders for this chunk. */
export const sampleChunkHeights = (gx: number, gz: number): Float32Array => {
  const heights = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) sampleChunkRow(gx, gz, iz, heights);
  return heights;
};

/** Rows along z (iz = 0..SEGMENTS) — the unit of work for the server's
 *  budgeted incremental chunk builds. */
export const TERRAIN_ROWS = N;
export const sampleChunkRow = (gx: number, gz: number, iz: number, heights: Float32Array): void => {
  const cx = chunkCenter(gx);
  const wz = -localY[iz] + chunkCenter(gz);
  for (let ix = 0; ix < N; ix++) {
    heights[ix * N + iz] = computeVertexData(localX[ix] + cx, wz).height;
  }
};
