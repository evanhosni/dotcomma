// Reach the raw .glsl assets as #defines (world/terrain/material.ts).

/** vWorldPosWrapped wrap period: a common multiple of every world-space period
 *  downstream (26.25u tile ×160, 75u sidewalk ×56, 200u fbm ×21) and both
 *  quantization grids (0.025, 0.2). A new world-space period must divide it. */
export const WORLD_WRAP = 4200;

export const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
