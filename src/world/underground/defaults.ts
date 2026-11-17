import { LOD1_SITE_DISTANCE } from "../terrain/lod/constants";
import { WORLD_CHUNK_SIZE } from "../chunks/constants";

/** Caves load a chunk past the LOD1 ring: an entrance's footprint can cross a 256u chunk edge. */
export const CAVE_RENDER_DISTANCE = LOD1_SITE_DISTANCE + WORLD_CHUNK_SIZE;
export const SEWER_RENDER_DISTANCE = 300;
export const DEFAULT_COLLIDER_DISTANCE = 64;
