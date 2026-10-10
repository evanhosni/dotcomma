import { CAMERA_FAR } from "../../player/constants";
import { FAR_FADE_FRACTION } from "../shaders/constants";

export const CHUNK_SIZE = 420;

// Integer multiples of CHUNK_SIZE.
export const LOD3_CHUNK_SIZE = CHUNK_SIZE * 2; // 840
export const LOD4_CHUNK_SIZE = CHUNK_SIZE * 4; // 1680

// LOD2 = 24 (17.5u): 12 made an 8× density cliff right at the LOD1 ring's edge.
export const LOD1_SEGMENTS = 96;
export const LOD2_SEGMENTS = 24;
export const LOD3_SEGMENTS = 12;
export const LOD4_SEGMENTS = 8;

// LOD1 (4.375u) stays the innermost ring only: at CHUNK_SIZE*2 it carried 92% of all terrain triangles.
// The player always stands on LOD1, which is what the slope-slide tuning assumes.
export const LOD1_MAX_DISTANCE = CHUNK_SIZE;
export const LOD2_MAX_DISTANCE = CHUNK_SIZE * 4;
export const LOD3_MAX_DISTANCE = CHUNK_SIZE * 8;
// The outermost ring reaches exactly the far plane (player/constants.ts CAMERA_FAR): every chunk with any
// point in front of it is drawn, and none past it is generated only to produce no pixel. Changing the
// render distance moves it with no retuning.
export const LOD4_MAX_DISTANCE = CAMERA_FAR;

export const MAX_RENDER_DISTANCE = LOD4_MAX_DISTANCE;

/** Whether a chunk's farthest corner reaches the far fade (world/shaders/farFade.ts), seen from (px, pz) with
 *  `margin` of travel to spare: only those chunks draw with the far-fade `discard`; the rest keep the opaque
 *  program's early depth test. Per chunk, not per LOD ring: the fade starts at ~2km, inside the LOD2/3 rings,
 *  and only their outer chunks reach it. Computed from CAMERA_FAR (a runtime-only camera.far change would
 *  need it recomputed). */
export const chunkReachesFarFade = (
  centerX: number,
  centerZ: number,
  chunkSize: number,
  px: number,
  pz: number,
  margin: number,
): boolean =>
  Math.hypot(Math.abs(centerX - px) + chunkSize / 2, Math.abs(centerZ - pz) + chunkSize / 2) + margin >=
  CAMERA_FAR * (1 - FAR_FADE_FRACTION);

export interface LODLevel {
  level: number;
  chunkSize: number;
  segments: number;
  maxDistance: number;
  hasCollider: boolean;
  /** Vertical skirt around the chunk edge hiding the seam to a coarser neighbor. The FINER
   *  chunk's skirt must exceed the worst height its coarser neighbor's straight segment
   *  misses by, which grows with vertex spacing. Worst gaps along four map-spanning lines of
   *  the overworld (with the mountain domes, at the coarser spacings of the time): LOD1|2 3u, LOD2|3 192u,
   *  LOD3|4 398u, hence 30 / 230 / 460. Finer segments only shrink the gaps. LOD4 is the outermost ring, with
   *  no coarser neighbor, so its 1000 only hangs past the far plane. */
  skirtDepth: number;
  /** Whether the chunk evaluates the river field (channel, river water, bed paint, city quay). The
   *  farthest visual-only LODs (840u / 3360u spacing) do not: a river there drew under 0.5% of its
   *  true water as isolated specks while building the per-cell river lists cost ~90% of their build
   *  time. LOD3 (210u) keeps it: it still draws a wide river near the ocean. */
  carvesRivers: boolean;
  /** Whether a collider LOD cuts the ground under bridge decks (computeVertexData step 7: the cut, the
   *  landing approaches, the mouths); the visual-only LODs never do (their path has no decks). LOD2
   *  KEEPS it: off, its cold build was 28–45% faster at bridge areas (enumerating a cell's decks), but
   *  the bowed approach road rose up to 7.5u through a deck's landed end (2 of 15 decks, ≤ 0.8u on the
   *  rest), a mound of several pixels at 420–600u that popped flat when LOD1 took over. */
  cutsDecks: boolean;
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
  {
    level: 1,
    chunkSize: CHUNK_SIZE,
    segments: LOD1_SEGMENTS,
    maxDistance: LOD1_MAX_DISTANCE,
    hasCollider: true,
    skirtDepth: 30,
    carvesRivers: true,
    cutsDecks: true,
    clampBlendFields: false,
  },
  {
    level: 2,
    chunkSize: CHUNK_SIZE,
    segments: LOD2_SEGMENTS,
    maxDistance: LOD2_MAX_DISTANCE,
    hasCollider: true,
    skirtDepth: 230,
    carvesRivers: true,
    cutsDecks: true,
    clampBlendFields: false,
  },
  {
    level: 3,
    chunkSize: LOD3_CHUNK_SIZE,
    segments: LOD3_SEGMENTS,
    maxDistance: LOD3_MAX_DISTANCE,
    hasCollider: false,
    skirtDepth: 460,
    carvesRivers: true,
    cutsDecks: false,
    clampBlendFields: true,
  },
  {
    level: 4,
    chunkSize: LOD4_CHUNK_SIZE,
    segments: LOD4_SEGMENTS,
    maxDistance: LOD4_MAX_DISTANCE,
    hasCollider: false,
    skirtDepth: 1000,
    carvesRivers: false,
    cutsDecks: false,
    clampBlendFields: true,
  },
];
