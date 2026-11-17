import { CAMERA_FAR } from "../../../player/constants";
import type { LODLevel } from "./types";

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

/** A cave entrance stands on LOD1's drawn ground: the LOD1-size chunks within LOD1_SITE_REACH of a loaded
 *  mouth draw at LOD1 out to this far (past the LOD1 ring), so an entrance never stands on coarser ground. */
export const LOD1_SITE_DISTANCE = CHUNK_SIZE * 2;
export const LOD1_SITE_REACH = 24;

export const MAX_RENDER_DISTANCE = LOD4_MAX_DISTANCE;

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
