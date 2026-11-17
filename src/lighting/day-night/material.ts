import { NIGHT_GROUND_DIM } from "./constants";

/** Unlit custom shaders (terrain, grass) reference this ONE uniform object — no per-frame writes. */
export const NIGHT_BLEND_UNIFORM = { value: 0 };
/** Expects `uniform float uNightBlend` bound to NIGHT_BLEND_UNIFORM. */
export const nightDimGLSL = (target: string): string =>
  `${target} *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);`;
