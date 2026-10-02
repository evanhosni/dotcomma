/** Devmode "tint skirts" (DEV_TOGGLES): 1 paints every terrain skirt face magenta, telling a skirt seen
 *  through a chunk seam from any other seam artifact. A shared uniform object, so toggling it is free. */
export const SKIRT_TINT_UNIFORM = "uTintSkirts";
export const skirtTintUniform = { value: 0 };

/** Last in the terrain fragment: vSkirt is 1 on a skirt's bottom ring and 0 on its top ring and the grid. */
export const SKIRT_TINT_GLSL = `if (${SKIRT_TINT_UNIFORM} > 0.5 && vSkirt > 0.0) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);`;
