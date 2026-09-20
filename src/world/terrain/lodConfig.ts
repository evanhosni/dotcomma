export const CHUNK_SIZE = 420;

// Integer multiples of CHUNK_SIZE.
export const LOD3_CHUNK_SIZE = CHUNK_SIZE * 2; // 840
export const LOD4_CHUNK_SIZE = CHUNK_SIZE * 4; // 1680
export const LOD5_CHUNK_SIZE = CHUNK_SIZE * 8; // 3360

// LOD2 = 24 (17.5u): 12 made an 8× density cliff right at the LOD1 ring's edge.
export const LOD1_SEGMENTS = 96;
export const LOD2_SEGMENTS = 24;
export const LOD3_SEGMENTS = 4;
export const LOD4_SEGMENTS = 2;
export const LOD5_SEGMENTS = 1;

// LOD1 (4.375u) once reached CHUNK_SIZE*2 and carried 92% of ALL terrain
// triangles. The player always stands on LOD1, so the slope-slide tuning
// (measured at LOD1 resolution) is unaffected by the ring sizes.
export const LOD1_MAX_DISTANCE = CHUNK_SIZE;
export const LOD2_MAX_DISTANCE = CHUNK_SIZE * 4;
export const LOD3_MAX_DISTANCE = CHUNK_SIZE * 8;
// Bounded by CAMERA_FAR (7200, Player.tsx): chunks past it are generated and
// kept without ever producing a pixel. One LOD5 chunk of slack keeps the
// horizon solid through the world curvature.
export const LOD4_MAX_DISTANCE = CHUNK_SIZE * 16; // 6720
export const LOD5_MAX_DISTANCE = CHUNK_SIZE * 20; // 8400 (> CAMERA_FAR)

/** Vertical skirt around chunk edges hiding LOD seams. */
export const SKIRT_DEPTH = 30;

export const MAX_RENDER_DISTANCE = LOD5_MAX_DISTANCE;

export interface LODLevel {
  level: number;
  chunkSize: number;
  segments: number;
  maxDistance: number;
  hasCollider: boolean;
}

export const LOD_LEVELS: LODLevel[] = [
  { level: 1, chunkSize: CHUNK_SIZE, segments: LOD1_SEGMENTS, maxDistance: LOD1_MAX_DISTANCE, hasCollider: true },
  { level: 2, chunkSize: CHUNK_SIZE, segments: LOD2_SEGMENTS, maxDistance: LOD2_MAX_DISTANCE, hasCollider: true },
  { level: 3, chunkSize: LOD3_CHUNK_SIZE, segments: LOD3_SEGMENTS, maxDistance: LOD3_MAX_DISTANCE, hasCollider: false },
  { level: 4, chunkSize: LOD4_CHUNK_SIZE, segments: LOD4_SEGMENTS, maxDistance: LOD4_MAX_DISTANCE, hasCollider: false },
  { level: 5, chunkSize: LOD5_CHUNK_SIZE, segments: LOD5_SEGMENTS, maxDistance: LOD5_MAX_DISTANCE, hasCollider: false },
];
