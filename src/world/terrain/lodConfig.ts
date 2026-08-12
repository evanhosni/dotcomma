// ── Terrain Tuning Constants ─────────────────────────────────────────────────
// Adjust these to tweak terrain quality, performance, and draw distance.

/** World-space size of the base terrain chunk (width & depth). */
export const CHUNK_SIZE = 420;

/** Per-LOD chunk sizes (must be integer multiples of CHUNK_SIZE). */
export const LOD3_CHUNK_SIZE = CHUNK_SIZE * 2; // 840
export const LOD4_CHUNK_SIZE = CHUNK_SIZE * 4; // 1680
export const LOD5_CHUNK_SIZE = CHUNK_SIZE * 8; // 3360

/** Mesh segment counts per LOD level (higher = more detail).
 *  LOD2 is 24 (17.5u spacing): with LOD1 confined to the innermost ring the
 *  old 12 (35u) made an 8× density cliff right at the player's doorstep. */
export const LOD1_SEGMENTS = 96;
export const LOD2_SEGMENTS = 24;
export const LOD3_SEGMENTS = 4;
export const LOD4_SEGMENTS = 2;
export const LOD5_SEGMENTS = 1;

/** Max distance from the player at which each LOD level is used.
 *  LOD1 (4.375u spacing) used to reach CHUNK_SIZE*2 and carried 92% of ALL
 *  terrain triangles; nothing needs that density past the immediate ring —
 *  flatten pads are 13-24u features and the city's fine detail (roads, curbs)
 *  is painted by the FRAGMENT shader from distance attributes, not resolved
 *  by geometry. The player always stands on LOD1, so the slope-slide tuning
 *  (measured at LOD1 collider resolution) is unaffected. */
export const LOD1_MAX_DISTANCE = CHUNK_SIZE;
export const LOD2_MAX_DISTANCE = CHUNK_SIZE * 4;
export const LOD3_MAX_DISTANCE = CHUNK_SIZE * 8;
export const LOD4_MAX_DISTANCE = CHUNK_SIZE * 24;
export const LOD5_MAX_DISTANCE = CHUNK_SIZE * 48;

/** Vertical depth of skirt geometry added around chunk edges to hide LOD seams. */
export const SKIRT_DEPTH = 30;

/** Absolute maximum terrain render distance (matches coarsest LOD). */
export const MAX_RENDER_DISTANCE = LOD5_MAX_DISTANCE;

// ── LOD Level Definitions ────────────────────────────────────────────────────

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
