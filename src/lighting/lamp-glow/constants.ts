export const LAMP_GLOW_RADIUS = 24; // world units of falloff reach
/** Must be ≥ LAMP_GLOW_RADIUS so the 3×3 neighborhood covers the falloff. */
export const LAMP_CELL_SIZE = 24;
export const LAMP_GRID_SIZE = 64;

/** Seconds a head's glow takes to come in when it registers and to go out when it is released: a
 *  dressing chunk mounting or dropping at the render distance lit or darkened a whole block at once. */
export const LAMP_FADE_SECONDS = 1;
/** The fade rides in the texel's w as color index + 1 + fade × this: under the next color's 0.5
 *  threshold, so the color selection is untouched (the shader reads it back with fract). */
export const FADE_ENCODE = 0.45;

/** Lit windows sit around 1.4; street lights burn much brighter. */
export const LAMP_EMISSIVE_STRENGTH = 12;
