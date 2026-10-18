import { _curvature } from "../../vfx/curvature";
import { _quantization } from "../../vfx/quantization";
import { FAR_DISTANCE_GLSL } from "./farFade";

/**
 * THE shared vertex stage of every chunk-relative custom program (the terrain, the tunnels, the snow
 * sheet, the rocks, the particles): wrapped chunk origin + local offset, quantized, projected through
 * `modelViewMatrix[3]` (the CPU-resolved view-space origin), curved — never an absolute float32 world
 * coordinate (CLAUDE.md "Coordinate precision"). It writes the wrapped/absolute position and world
 * normal varyings. A program including it carries quantization and curvature itself and must not be
 * patched again (Dressing.tsx selfPatchedMaterial).
 */

export const CHUNK_PROJECTION_VARYINGS = ["varying vec3 vWorldPosWrapped;", "varying vec3 vWorldPosAbs;", "varying vec3 vWorldNormal;", "varying float vFarDistance;"];

/** Needs the WORLD_WRAP define and the uGridSize / uCurveStart / uCurveK uniforms (shared objects). */
export const CHUNK_PROJECTION_GLSL = /* glsl */ `
${_quantization.QUANTIZE_GLSL}
${_curvature.CURVE_GLSL}
${FAR_DISTANCE_GLSL}
${CHUNK_PROJECTION_VARYINGS.join("\n")}

vec4 projectChunkLocal(vec3 localPos, vec3 localNormal) {
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * localPos;
  vec3 worldPos = quantizeWorldPos(wrapOrigin + localWorld);
  vWorldPosWrapped = worldPos;
  // Unwrapped: ONLY for comparing against CPU-side absolute positions (lamp grid, point lights, the
  // terrain holes). Never for tiling, quantization or fwidth() guards.
  vWorldPosAbs = chunkOrigin + localWorld;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  vFarDistance = farFadeDistance(viewPos);
  return projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
`;

/** The uniform objects the projection reads, shared so everything bends and snaps in lockstep. */
export const CHUNK_PROJECTION_UNIFORMS = {
  uGridSize: _quantization.uniforms.uGridSize,
  uCurveStart: _curvature.uniforms.uCurveStart,
  uCurveK: _curvature.uniforms.uCurveK,
};
