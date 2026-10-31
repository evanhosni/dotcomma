import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../../lighting/dayNight";
import { ditherGLSL } from "../../../vfx/dither";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../../../world/shaders/chunkProjection";
import commonShader from "../../../world/shaders/common.glsl";
import { glslFloat, WORLD_WRAP } from "../../../world/shaders/constants";
import { SNOW_TRAIL_GLSL, SNOW_TRAIL_UNIFORMS, SNOW_TRAIL_UNIFORMS_GLSL } from "./trail";

/** The near snow sheet's material (SnowDrift.tsx): the mountain's snow under the terrain's
 *  fake sun, no tone mapping, both sides; each vertex SINKS by its depth as the camera distance goes
 *  SINK_START → SINK_END, so the sheet goes under the whitened ground before it drops. Where capsules
 *  walked (snowTrail.ts) a vertex sinks by TRAIL_SINK of its depth (at most TRAIL_SINK_MAX) and the
 *  pixel darkens by TRAIL_SHADE: a trench that recovers as the stamps age. */

const SINK_START = 320;
const SINK_END = 400;
const SINK_EXTRA = 0.15;
const TRAIL_SINK = 0.75;
const TRAIL_SINK_MAX = 0.7;
const TRAIL_SHADE = 0.42;

export const createSnowMaterial = (): THREE.ShaderMaterial => {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...CHUNK_PROJECTION_UNIFORMS, uNightBlend: NIGHT_BLEND_UNIFORM, ...SNOW_TRAIL_UNIFORMS },
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP) },
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float depth;
      varying float vDent;
      ${SNOW_TRAIL_UNIFORMS_GLSL}
      ${SNOW_TRAIL_GLSL}
      ${CHUNK_PROJECTION_GLSL}
      void main() {
        // Chunk-LOCAL (projectChunkLocal applies the model matrix itself); the sheet's group is unrotated.
        vec3 localWorld = position;
        vec3 worldAbs = modelMatrix[3].xyz + mat3(modelMatrix) * position;
        float dist = distance(worldAbs.xz, cameraPosition.xz);
        localWorld.y -= (depth + ${glslFloat(SINK_EXTRA)}) * smoothstep(${glslFloat(SINK_START)}, ${glslFloat(SINK_END)}, dist);
        // The trail is read on the absolute position (the stamps are absolute, like the lamp grid).
        float dent = depth > 0.02 ? snowTrailDent(worldAbs.xz) : 0.0;
        vDent = dent;
        localWorld.y -= min(depth * ${glslFloat(TRAIL_SINK)}, ${glslFloat(TRAIL_SINK_MAX)}) * dent;
        gl_Position = projectChunkLocal(localWorld, normal);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNightBlend;
      varying vec3 vWorldNormal;
      varying float vDent;
      ${commonShader}
      void main() {
        vec3 n = normalize(vWorldNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 col = vec3(0.93, 0.95, 0.98) * (0.6 + 0.4 * fakeSunLight(n));
        col *= 1.0 - ${glslFloat(TRAIL_SHADE)} * vDent;
        ${nightDimGLSL("col")}
        ${ditherGLSL("col")}
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return material;
};
