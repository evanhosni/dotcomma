import { LOD_LEVELS } from "../terrain/lodConfig";
import { glslFloat, MATERIAL_LOD_BLUR } from "./constants";

/**
 * The terrain material's LOD BLUR: every narrow paint edge (the biome walls' feathers, the city's road
 * bands, the riverbed's edge, the freeway corridor) widens with the camera distance in step with the
 * LOD rings' vertex spacing. Those edges are thresholds on fields the GPU interpolates LINEARLY between
 * vertices, so on a coarse ring a crisp edge draws the triangulation itself (sawtooth roads, zigzag
 * walls); softened over about half a vertex spacing, it blurs instead.
 *
 * `lodBlur` (world units, a fragment-stage global the biome frags read) is a piecewise-linear ramp of the
 * horizontal camera distance: 0 at the player, MATERIAL_LOD_BLUR × LOD1's spacing halfway out its ring,
 * then MATERIAL_LOD_BLUR × each ring's spacing at its inner edge. A ramp, not the chunk's own spacing:
 * a per-chunk step would draw every ring border as a line where the edges' softness jumps.
 *
 * The biome fields are the exception: the far LODs CLAMP them (LODLevel.clampBlendFields), so their
 * interpolation is already a cross-fade over one triangle, and widened past ±1 a slot's weight would
 * never saturate (every biome bleeding into every other). Their widening is gated per CHUNK by
 * BLEND_FIELDS_CLAMPED_UNIFORM, written per mesh like the dither range (chunkObjects.ts syncChunkUniforms).
 */

export const BLEND_FIELDS_CLAMPED_UNIFORM = "uBlendFieldsClamped";

const spacingOf = (i: number) => LOD_LEVELS[i].chunkSize / LOD_LEVELS[i].segments;

/** [horizontal distance, blur] knots, ascending. */
const BLUR_KNOTS: [number, number][] = [
  [0, 0],
  [LOD_LEVELS[0].maxDistance / 2, spacingOf(0) * MATERIAL_LOD_BLUR],
  ...LOD_LEVELS.slice(1).map((_, j): [number, number] => [LOD_LEVELS[j].maxDistance, spacingOf(j + 1) * MATERIAL_LOD_BLUR]),
];

const blurRampGLSL = (): string => {
  const [last] = BLUR_KNOTS.slice(-1);
  const segments = BLUR_KNOTS.slice(1).map(
    ([d1, b1], j) => {
      const [d0, b0] = BLUR_KNOTS[j];
      return `if (d < ${glslFloat(d1)}) return mix(${glslFloat(b0)}, ${glslFloat(b1)}, (d - ${glslFloat(d0)}) / ${glslFloat(d1 - d0)});`;
    },
  );
  return `${segments.join("\n    ")}\n    return ${glslFloat(last[1])};`;
};

/** Fragment stage, before the biome frags: the global, its ramp and the widened smoothstep. */
export const LOD_BLUR_GLSL = /* glsl */ `
  uniform float ${BLEND_FIELDS_CLAMPED_UNIFORM};
  float lodBlur = 0.0;
  float lodBlurAt(float d) {
    ${blurRampGLSL()}
  }
  /** smoothstep(e0, e1, x) widened by lodBlur on both sides, about the same midpoint. */
  float blurStep(float e0, float e1, float x) {
    float mid = 0.5 * (e0 + e1);
    float reach = 0.5 * (e1 - e0) + lodBlur;
    return smoothstep(mid - reach, mid + reach, x);
  }
`;
