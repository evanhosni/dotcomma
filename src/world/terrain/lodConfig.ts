import { CAMERA_FAR } from "../../player/constants";
import { reportContentError } from "../../utils/contentError";

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

// LOD1 (4.375u) stays the innermost ring only: at CHUNK_SIZE*2 it carried 92% of all terrain triangles.
// The player always stands on LOD1, which is what the slope-slide tuning assumes.
export const LOD1_MAX_DISTANCE = CHUNK_SIZE;
export const LOD2_MAX_DISTANCE = CHUNK_SIZE * 4;
export const LOD3_MAX_DISTANCE = CHUNK_SIZE * 8;
// Bounded by CAMERA_FAR (player/constants.ts): chunks past it are generated and kept without ever
// producing a pixel. LOD5 reaches just past it, so the horizon stays solid through the world curvature.
export const LOD4_MAX_DISTANCE = CHUNK_SIZE * 16; // 6720
export const LOD5_MAX_DISTANCE = CHUNK_SIZE * 20; // 8400
if (!(LOD4_MAX_DISTANCE <= CAMERA_FAR && CAMERA_FAR < LOD5_MAX_DISTANCE)) {
  reportContentError(`[terrain] CAMERA_FAR (${CAMERA_FAR}) must lie between the LOD4 and LOD5 rings (${LOD4_MAX_DISTANCE}–${LOD5_MAX_DISTANCE}): retune them together`);
}

export const MAX_RENDER_DISTANCE = LOD5_MAX_DISTANCE;

export interface LODLevel {
  level: number;
  chunkSize: number;
  segments: number;
  maxDistance: number;
  hasCollider: boolean;
  /** Vertical skirt around the chunk edge hiding the seam to a coarser neighbor. The FINER
   *  chunk's skirt must exceed the worst height its coarser neighbor's straight segment
   *  misses by, which grows with vertex spacing. Worst gaps along four map-spanning lines of
   *  the overworld (with the mountain domes): LOD1|2 3u, LOD2|3 192u, LOD3|4 398u, LOD4|5 849u,
   *  hence 30 / 230 / 460 / 1000, and 450 for LOD5 (380u above LOD4). */
  skirtDepth: number;
  /** Whether the chunk evaluates the river field (channel, river water, bed paint, city quay). The
   *  farthest visual-only LODs (840u / 3360u spacing) do not: a river there drew under 0.5% of its
   *  true water as isolated specks while building the per-cell river lists cost ~90% of their build
   *  time. LOD3 (210u) keeps it: it still draws a wide river near the ocean. */
  carvesRivers: boolean;
  /** Clamp the biome blend fields to where the shader saturates (sdf ±1, presence 0..1) before
   *  upload — exact at every vertex, and it makes them interpolate as a plain cross-fade. Unclamped,
   *  a slot reads ±BIOME_SDF_FAR where no wall is in reach and ±(distance / feather half) elsewhere,
   *  so across a coarse triangle spanning three zones (or a far and a near value) EVERY slot
   *  interpolates below -1: zero weight, a BLACK pixel (black patches on the horizon). Only on
   *  LODs whose vertex spacing already cannot resolve a feather; the near LODs keep the true
   *  distances, which put a 1u city edge exactly where it belongs on a 4.375u quad. */
  clampBlendFields: boolean;
}

export const LOD_LEVELS: LODLevel[] = [
  { level: 1, chunkSize: CHUNK_SIZE, segments: LOD1_SEGMENTS, maxDistance: LOD1_MAX_DISTANCE, hasCollider: true, skirtDepth: 30, carvesRivers: true, clampBlendFields: false },
  { level: 2, chunkSize: CHUNK_SIZE, segments: LOD2_SEGMENTS, maxDistance: LOD2_MAX_DISTANCE, hasCollider: true, skirtDepth: 230, carvesRivers: true, clampBlendFields: false },
  { level: 3, chunkSize: LOD3_CHUNK_SIZE, segments: LOD3_SEGMENTS, maxDistance: LOD3_MAX_DISTANCE, hasCollider: false, skirtDepth: 460, carvesRivers: true, clampBlendFields: true },
  { level: 4, chunkSize: LOD4_CHUNK_SIZE, segments: LOD4_SEGMENTS, maxDistance: LOD4_MAX_DISTANCE, hasCollider: false, skirtDepth: 1000, carvesRivers: false, clampBlendFields: true },
  { level: 5, chunkSize: LOD5_CHUNK_SIZE, segments: LOD5_SEGMENTS, maxDistance: LOD5_MAX_DISTANCE, hasCollider: false, skirtDepth: 450, carvesRivers: false, clampBlendFields: true },
];
