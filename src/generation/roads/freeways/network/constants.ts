export const NETWORK_RADIUS_CELLS = 18;
/** Sources, runs and hops within this many cells of the window's border are not trusted (see getNetwork). */
export const NETWORK_BORDER_CELLS = 3;
/** Every biome cell a vertex lands in needs its network (~10 KB, ~20 ms to build), and the terrain
 *  worker's LOD rings alone touch ~720 cells around a spawn. */
export const NETWORK_CACHE_MAX = 1024;
/** Freeways combine their segments by a smooth minimum (real units) and are measured from a
 *  gently meandered query point: a road may wind, not wobble. */
export const FREEWAY_SMIN_K = 14;
export const FREEWAY_MEANDER_AMP = 3;
export const FREEWAY_MEANDER_SCALE = 160;
/** City components at most this many cells apart get a freeway between them. */
export const FREEWAY_LINK_CELLS = 4;
/** A path longer than this × the straight distance between the two cities is a detour (the
 *  pair relays through whatever lies between) and is dropped. */
export const FREEWAY_PATH_MAX_STRETCH = 1.7;
/** Gap hops: chains of at most this many walkable walls / this long between the boundaries of two
 *  different city cells become freeways too (the short grass gaps between lobes of a city). */
export const FREEWAY_GAP_WALLS = 2;
export const FREEWAY_GAP_LENGTH = 450;
