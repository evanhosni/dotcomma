import * as THREE from "three";
import { FADE_OPAQUE_HI } from "../terrain/lodSwaps";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL, SUN_DIRECTION } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
import { _curvature } from "../../vfx/curvature";
import { glslFloat, WORLD_WRAP } from "../shaders/constants";
import { LOD_FADE_GLSL, LOD_FADE_UNIFORM } from "../shaders/lodFade";
import commonShader from "../shaders/common.glsl";

/**
 * THE WATER SYSTEM's surface material — one shared ShaderMaterial for every chunk's
 * water mesh (TerrainRenderer builds those from the terrain worker's `waterHeights`,
 * as children of the terrain chunk so they share its lifecycle, LOD and visibility).
 *
 * Motion is an ILLUSION in the shader: the vertices ride the CPU's flat water level
 * (lake level / river surface), the vertex shader adds a small two-wave swell and the
 * fragment shader scrolls a noise normal for glints — no per-frame buffer writes.
 * Same rebase/wrap/curvature scheme as the terrain vertex shader (see CLAUDE.md,
 * Coordinate Precision); wave wavelengths DIVIDE WORLD_WRAP so the swell never seams.
 */

const WATER_VERT = /* glsl */ `
attribute float waterDepth;
varying float vWaterDepth;
varying vec3 vWorldPosWrapped;
varying vec3 vWorldPosAbs;
varying vec3 vViewDir;
uniform float uTime;

void main() {
  vWaterDepth = waterDepth;

  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * position;
  vec3 worldPos = wrapOrigin + localWorld;

  // Two crossing swells; 70u and 50u wavelengths both divide the 4200u wrap.
  float swell = sin(worldPos.x * (6.2831853 / 70.0) + uTime * 1.1) * sin(worldPos.z * (6.2831853 / 50.0) + uTime * 0.8);
  // Only where there is real depth — a dry edge must not rise out of the ground.
  worldPos.y += 0.18 * swell * clamp(waterDepth * 0.5, 0.0, 1.0);

  vWorldPosWrapped = worldPos;
  vWorldPosAbs = chunkOrigin + localWorld;
  vViewDir = cameraPosition - vWorldPosAbs;

  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
`;

const WATER_FRAG = /* glsl */ `
varying float vWaterDepth;
varying vec3 vWorldPosWrapped;
varying vec3 vWorldPosAbs;
varying vec3 vViewDir;
uniform float uTime;
uniform float uNightBlend;
uniform vec3 uSunDirection;
uniform vec2 ${LOD_FADE_UNIFORM};

${commonShader}
${LOD_FADE_GLSL}

void main() {
  // The surface dives under the ground where the CPU found no water; nothing to draw there.
  if (vWaterDepth <= 0.02) discard;
  // Follows its terrain chunk through a LOD swap: the old and new sheets never both draw a pixel.
  if (lodFadeDiscards(${LOD_FADE_UNIFORM})) discard;

  // Scrolling noise normal: two octaves drifting in different directions.
  vec2 p = vWorldPosWrapped.xz;
  float n1 = worldFbm(p + vec2(uTime * 1.6, uTime * 0.9), 0.05, 2);
  float n2 = worldFbm(p - vec2(uTime * 1.1, -uTime * 1.4), 0.09, 2);
  vec3 normal = normalize(vec3((n1 - 0.5) * 0.35, 1.0, (n2 - 0.5) * 0.35));

  vec3 viewDir = normalize(vViewDir);
  float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 3.0);

  // Shallow turquoise → deep slate blue by depth.
  float depthT = clamp(vWaterDepth / 14.0, 0.0, 1.0);
  vec3 shallow = vec3(0.22, 0.55, 0.58);
  vec3 deep = vec3(0.05, 0.16, 0.30);
  vec3 color = mix(shallow, deep, depthT);
  color = mix(color, vec3(0.62, 0.72, 0.80), fresnel * 0.6);

  // Sun glint.
  vec3 h = normalize(viewDir + uSunDirection);
  float spec = pow(clamp(dot(normal, h), 0.0, 1.0), 90.0);
  color += vec3(1.0, 0.97, 0.9) * spec * 0.6 * (1.0 - uNightBlend);

  // Shore: fade out over the last ~2.5u of depth — a hard cut (or a sub-unit fade) traces the
  // terrain's LOD triangles as a staircase along every shoreline; on a lake's gentle bed 2.5u
  // of depth is ~10–20u of shore.
  float alpha = (mix(0.55, 0.9, depthT) + fresnel * 0.1) * smoothstep(0.02, 2.5, vWaterDepth);

  ${nightDimGLSL("color")}
  ${ditherGLSL("color")}
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
}
`;

const WATER_TIME_UNIFORM = { value: 0 };

let material: THREE.ShaderMaterial | null = null;

/** The one water material (created lazily; survives domain switches like the geometry pool). */
export const getWaterMaterial = (): THREE.ShaderMaterial => {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    vertexShader: `${_curvature.CURVE_GLSL}\n${WATER_VERT}`,
    fragmentShader: WATER_FRAG,
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP) },
    uniforms: {
      uTime: WATER_TIME_UNIFORM,
      uNightBlend: NIGHT_BLEND_UNIFORM,
      uSunDirection: { value: SUN_DIRECTION.clone() },
      // Per mesh: each chunk's water writes its range right before its draw (TerrainRenderer syncLodFade).
      [LOD_FADE_UNIFORM]: { value: new THREE.Vector2(0, FADE_OPAQUE_HI) },
      uCurveStart: _curvature.uniforms.uCurveStart,
      uCurveK: _curvature.uniforms.uCurveK,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return material;
};

/** Advances the swell/glint clock; called once per frame by TerrainRenderer. */
export const tickWater = (elapsedSeconds: number): void => {
  WATER_TIME_UNIFORM.value = elapsedSeconds;
};
