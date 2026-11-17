import * as THREE from "three";
import { chainMaterialPatch } from "../../vfx/material";
import { glslFloat } from "../../world/shaders/utils";
import { LAMP_COLORS } from "./enums";
import { LAMP_CELL_SIZE, LAMP_GRID_SIZE, LAMP_GLOW_RADIUS, FADE_ENCODE } from "./constants";
import { LAMP_GRID_UNIFORMS } from ".";

/** The declarations lampGlowAccumGLSL needs, for a ShaderMaterial that spreads LAMP_GRID_UNIFORMS. */
export const LAMP_GLOW_UNIFORMS_GLSL = `
uniform sampler2D uLampGrid;
uniform vec2 uLampGridOrigin;
uniform float uLampGlowIntensity;
`;

const vec3GLSL = (rgb: readonly number[]): string => `vec3(${rgb.map(glslFloat).join(", ")})`;

/** `lampG.w > 3.5 ? green : lampG.w > 2.5 ? yellow : … : warm` (w = color index + 1). */
const LAMP_COLOR_SELECT_GLSL = LAMP_COLORS.slice(1).reduce(
  (chain, color, i) => `lampG.w > ${glslFloat(i + 1.5)} ? ${vec3GLSL(color.rgb)} : ${chain}`,
  vec3GLSL(LAMP_COLORS[0].rgb),
);

/** Accumulates the glow at `worldPosExpr` into a local `vec3 lampGlowSum`. */
export const lampGlowAccumGLSL = (worldPosExpr: string): string => `
  vec3 lampGlowSum = vec3(0.0);
  if (uLampGlowIntensity > 0.001) {
    vec2 lampCell = floor(${worldPosExpr}.xz / ${LAMP_CELL_SIZE.toFixed(1)});
    for (int lampGi = -1; lampGi <= 1; lampGi++) {
      for (int lampGj = -1; lampGj <= 1; lampGj++) {
        vec2 lampTC = (lampCell + vec2(float(lampGi), float(lampGj)) - uLampGridOrigin + 0.5) / ${LAMP_GRID_SIZE.toFixed(1)};
        if (lampTC.x < 0.0 || lampTC.x > 1.0 || lampTC.y < 0.0 || lampTC.y > 1.0) continue;
        vec4 lampG = texture2D(uLampGrid, lampTC);
        if (lampG.w > 0.5) {
          float lampFall = clamp(1.0 - distance(${worldPosExpr}, lampG.xyz) / ${LAMP_GLOW_RADIUS.toFixed(1)}, 0.0, 1.0);
          vec3 lampCol = ${LAMP_COLOR_SELECT_GLSL};
          float lampFade = clamp(fract(lampG.w) / ${FADE_ENCODE.toFixed(2)}, 0.0, 1.0);
          lampGlowSum += lampCol * (lampFall * lampFall * lampFade);
        }
      }
    }
    lampGlowSum *= uLampGlowIntensity;
  }
`;

/** Adds lamp glow to a lit material's indirect irradiance. Idempotent. */
export const patchStandardMaterialLampGlow = (material: THREE.Material, strength = 0.5): void => {
  if ((material as any).__lampGlowPatched) return;
  // strength is baked into the GLSL: a different strength is a different program, and without it
  // in the key the second material silently reuses the first one's compiled shader.
  chainMaterialPatch(material, "_lampGlow" + strength.toFixed(2), (shader) => {
    shader.uniforms.uLampGrid = LAMP_GRID_UNIFORMS.uLampGrid;
    shader.uniforms.uLampGridOrigin = LAMP_GRID_UNIFORMS.uLampGridOrigin;
    shader.uniforms.uLampGlowIntensity = LAMP_GRID_UNIFORMS.uLampGlowIntensity;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLampWorldPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvec4 lampLocal = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nlampLocal = instanceMatrix * lampLocal;\n#endif\nvLampWorldPos = (modelMatrix * lampLocal).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${LAMP_GLOW_UNIFORMS_GLSL}\nvarying vec3 vLampWorldPos;`)
      .replace(
        "#include <lights_fragment_begin>",
        `#include <lights_fragment_begin>
        ${lampGlowAccumGLSL("vLampWorldPos")}
        irradiance += lampGlowSum * ${strength.toFixed(2)};`,
      );
  });
  (material as any).__lampGlowPatched = true;
};
