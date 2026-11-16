/** WATER's fixed numbers, shared by every body (water/DECISIONS.md holds the why). Three-free. */

/** How far a carved shore stands above its water: a lake's shore above its level (both sides of the
 *  wall), and the RIM of every river and pond channel above its surface. */
export const SHORE_RISE = 1.5;

/** Past a freeway's half-width a river's merge with a lake (and past the belt's, its walls) fade in from the
 *  first to the second (real units): a road along the shore stays on dry ground, and every deck's landing stays flush. */
export const ROAD_FADE_NEAR = 10;
export const ROAD_FADE_FAR = 40;

/** A river's or a pond's water stands this far under the lowest ground across it — deeper than a lake's
 *  shore rise, so a city quay stays above both. */
export const WATER_BELOW_GROUND = 2.5;

/** Past a river's or a pond's footprint by this much (real units) a point reads no channel: the river
 *  field's support (rivers/field.ts), which every channel's walls ease out within. */
export const RIVER_FIELD_READ = 440;
