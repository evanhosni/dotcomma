import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../../src/world/terrain/lodConfig";

/**
 * The client's LOD1 collider EXACTLY (terrain.worker.ts → generateColliders):
 * same fround'd local grid, same PlaneGeometry z-flip, same column-major
 * layout, body at the chunk CENTER — bit-identical ground to the player's.
 * Only LOD1: the resolution the player stands on and the slope tuning was
 * measured at. Rapier-free, so the generation worker runs it.
 */

export const TERRAIN_CHUNK_SIZE = CHUNK_SIZE;
export const TERRAIN_SEGMENTS = LOD1_SEGMENTS;
/** Vertices per side; a row is the unit of work for budgeted incremental chunk builds. */
export const TERRAIN_ROWS = TERRAIN_SEGMENTS + 1;
/** 4.375u: what the heightfield resolves. */
export const TERRAIN_VERTEX_SPACING = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS;
const HALF = TERRAIN_CHUNK_SIZE / 2;

export const chunkIndex = (v: number): number => Math.floor(v / TERRAIN_CHUNK_SIZE);
export const chunkCenter = (g: number): number => g * TERRAIN_CHUNK_SIZE + HALF;

// fround keeps heights bit-identical to the float32 positions the client samples.
const localX = new Float64Array(TERRAIN_ROWS);
const localY = new Float64Array(TERRAIN_ROWS);
for (let i = 0; i < TERRAIN_ROWS; i++) {
  localX[i] = Math.fround((i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE - HALF);
  localY[i] = Math.fround(-(i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE + HALF);
}

export const vertexWorld = (gx: number, gz: number, ix: number, iz: number): { x: number; z: number } => ({
  x: chunkCenter(gx) + localX[ix],
  z: chunkCenter(gz) - localY[iz],
});

/** The collider surface is exact at a vertex. */
export const snapToVertex = (x: number, z: number): { x: number; z: number } => ({
  x: Math.round(x / TERRAIN_VERTEX_SPACING) * TERRAIN_VERTEX_SPACING,
  z: Math.round(z / TERRAIN_VERTEX_SPACING) * TERRAIN_VERTEX_SPACING,
});

/** Column-major, exactly what the client's terrain worker hands generateColliders. */
export const sampleChunkHeights = (gx: number, gz: number): Float32Array => {
  const heights = new Float32Array(TERRAIN_ROWS * TERRAIN_ROWS);
  for (let iz = 0; iz < TERRAIN_ROWS; iz++) sampleChunkRow(gx, gz, iz, heights);
  return heights;
};

export const sampleChunkRow = (gx: number, gz: number, iz: number, heights: Float32Array): void => {
  const cx = chunkCenter(gx);
  const wz = -localY[iz] + chunkCenter(gz);
  for (let ix = 0; ix < TERRAIN_ROWS; ix++) {
    heights[ix * TERRAIN_ROWS + iz] = computeVertexData(localX[ix] + cx, wz).height;
  }
};
