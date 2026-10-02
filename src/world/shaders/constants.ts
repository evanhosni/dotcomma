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
 *  and the foliage worker thins plants out across the same fade. The fade is RIVER_BED_BLEND_WIDTH wide
 *  (9–22u real with the width factor): natural ground grades into the bed instead of stopping on a
 *  line. City pavement never fades (the shader's pavement mask; the quay's bed distance is inset by
 *  FULL, so the sand is whole right past its sidewalk) — a long fade there read as the sidewalk
 *  smearing into the riverbed. */
export const RIVER_BED_FADE_INSET = 1;
export const RIVER_BED_BLEND_WIDTH = 9;
export const RIVER_BED_FULL_INSET = RIVER_BED_FADE_INSET + RIVER_BED_BLEND_WIDTH;

/** Each biome's riverbed texture cross-fades into its neighbor's over at least this HALF width (real
 *  units) across a biome wall, whatever the biomes' own feathers: the bed is not its biome's ground,
 *  and beside the crisp city (a 1u half) the bed's sand met the snow's gravel on a hard line. */
export const RIVER_BED_TEXTURE_HALF = 8;

/** The riverbed paint yields to the ground beneath it on steep banks: fully painted up to START,
 *  gone by END (slope from the world normal, degrees) — a mountainside rising out of a river keeps
 *  its rock instead of a band of gravel. */
export const RIVER_BED_SLOPE_START_DEG = 30;
export const RIVER_BED_SLOPE_END_DEG = 40;

/** The riverBedDistance ATTRIBUTE's "no river" value. The pipeline reports Infinity out of a river's
 *  reach, but a vertex attribute must stay FINITE: a triangle with one Infinity vertex interpolates to
 *  NaN over its whole area, and Metal's fast-math shaders take `NaN < RIVER_BED_REACH` as true — every
 *  triangle straddling the field's reach (chunk edges, the far ring around each river) painted the
 *  riverbed as a dark triangle on the Mac (D3D's IEEE compare hid it on Windows). Far enough that a
 *  triangle mixing it with any in-field distance never crosses the paint reach. */
export const RIVER_BED_FAR = 1e4;
