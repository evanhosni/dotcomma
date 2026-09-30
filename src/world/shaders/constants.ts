// Reach the raw .glsl assets as #defines (world/terrain/material.ts).

/** vWorldPosWrapped wrap period: a common multiple of every world-space period
 *  downstream (26.25u tile ×160, 75u sidewalk ×56, 200u fbm ×21) and both
 *  quantization grids (0.025, 0.2). A new world-space period must divide it. */
export const WORLD_WRAP = 4200;

export const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** The freeway CORRIDOR off the city, in the road field's normalized street units: the terrain shader
 *  paints the city's own road frag fully out to the curb strip's outer edge (INNER) and fades it out by
 *  OUTER, and the road-fragment pass (utils/workers/roads/roadFragments.ts) counts that corridor as land. */
export const FREEWAY_CORRIDOR_INNER = 8;
export const FREEWAY_CORRIDOR_OUTER = 9.5;

/** The riverbed PAINT's edge, as insets from RIVER_BED_REACH (riverBedDistance, factor-1 units): the
 *  terrain shader covers the ground with the bed out to REACH − FULL and fades it out by REACH − FADE,
 *  and the foliage worker thins plants out against the same edge. */
export const RIVER_BED_FULL_INSET = 3;
export const RIVER_BED_FADE_INSET = 1;

/** The riverbed paint yields to the ground beneath it on steep banks: fully painted up to START,
 *  gone by END (slope from the world normal, degrees) — a mountainside rising out of a river keeps
 *  its rock instead of a band of gravel. */
export const RIVER_BED_SLOPE_START_DEG = 30;
export const RIVER_BED_SLOPE_END_DEG = 40;
