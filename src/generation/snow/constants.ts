/** No snow below the line's foot, full by its top (ground height). */
export const SNOW_LINE_LOW = 40;
export const SNOW_LINE_HIGH = 100;
/** Altitude: 0 at the low height, 1 by the high one. */
export const ALTITUDE_LOW = 20;
export const ALTITUDE_HIGH = 250;
/** The slope limit (degrees) and how much higher ground raises it; the pile's edge softens over ±SLOPE_SOFT. */
export const SLOPE_LIMIT = 40;
export const SLOPE_LIMIT_ALTITUDE = 15;
export const SLOPE_SOFT = 6;
/** The terrain's own snow reaches this much steeper than the piles, softened over ±GROUND_SLOPE_SOFT. */
export const GROUND_SLOPE_EXTRA = 15;
export const GROUND_SLOPE_SOFT = 16;
/** The amount's threshold; the ground's own snow begins GROUND_AMOUNT_PAST of amount past the piles' edge
 *  and is whole GROUND_AMOUNT_FADE of amount past its own (fading into the rock gradually). */
export const AMOUNT_OFFSET = 0.32;
export const GROUND_AMOUNT_PAST = 0.08;
export const GROUND_AMOUNT_FADE = 0.3;
/** The ground's own snow (0–1) as a depth: the terrain shows its snow whole by this much depth
 *  (world/shaders/biome-materials/index.ts GROUND_SNOW_GLSL). */
export const GROUND_DEPTH_SHARE = 0.35;
export const SNOW_DEPTH_MAX = 1.85;
/** The pile rises over a quarter-circle edge over this much amount. */
export const EDGE_AMOUNT = 0.18;
/** Cover fades in over this past a road's, freeway's or river's keep-off. */
export const KEEP_OFF_FADE = 4;
/** Water: no snow under it or within this of its surface. */
export const WATER_CLEAR = 0.3;
/** Snow at least this deep is the "snow" surface (its walk and slope multipliers: physics/movement-modifiers/constants.ts);
 *  thinner is a dusting over the biome's own ground. */
export const SNOW_WADE_DEPTH = 0.05;
/** The sheet's grid, and how far the cut edge sits under the ground. */
export const SNOW_GRID = 2;
export const EDGE_SINK = 0.05;

// ── The cover lattice (the near sheet and the wading read cover on the LOD1 lattice) ─────────

export const COVER_CACHE_MAX = 1 << 16;

/** A capsule whose feet stand farther than this from the drawn ground (in a tunnel under it, or in
 *  the air over it) is not in the snow on that ground. */
export const SNOW_FEET_TOLERANCE = 1.5;
