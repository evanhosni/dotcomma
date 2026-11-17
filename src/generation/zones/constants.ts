/** Saturates the shader's smoothstep either way; small enough to stay exact in float32. */
export const BIOME_SDF_FAR = 1e4;

/** Zones whose weight is worth evaluating; below this the height contribution is invisible. */
export const ZONE_WEIGHT_EPS = 1e-4;
