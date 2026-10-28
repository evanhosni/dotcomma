import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL, SUN_DIRECTION } from "../../lighting/dayNight";
import { ditherGLSL, SCREEN_DOOR_GLSL } from "../../vfx/dither";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../shaders/chunkProjection";
import commonShader from "../shaders/common.glsl";
import { glslFloat, WORLD_WRAP } from "../shaders/constants";
import { FAR_FADE_DEFINE, FAR_FADE_GLSL, FAR_FADE_UNIFORM, FAR_FADE_UNIFORMS } from "../shaders/farFade";
import { LOD_FADE_GLSL, LOD_FADE_UNIFORM } from "../shaders/lodFade";
import { FADE_OPAQUE_HI } from "../terrain/lodSwaps";

/**
 * THE water sheet's material (CLAUDE.md "Lakes", "Rivers"): one shared ShaderMaterial on one clock for
 * every chunk's water mesh (world/terrain/chunkObjects.ts). Per vertex it reads `waterDepth` and
 * `waterFlow` (x/z): swells beat faster and higher with the flow, the surface noise drifts on still water
 * and is ADVECTED along a river, a steep sheet (a fall) whitens and streaks. The LOD cross-fade and the far
 * fade dither it like the ground under it (uLodFade is written per mesh by chunkObjects.ts syncLodFade).
 */

/** Swell wavelengths: each divides WORLD_WRAP, so the phase survives the wrap. */
const SWELL_LONG = 70;
const SWELL_MID = 50;
const SWELL_SHORT = 28;
/** A river's noise advects this far per cycle at |flow| = 1 (16u/s at full flow, 5u/s at the trickle). */
const ADVECT_DISTANCE = 40;
const ADVECT_CYCLE = 2.5;

const WATER_VERTEX = /* glsl */ `
${CHUNK_PROJECTION_GLSL}
attribute float waterDepth;
attribute vec2 waterFlow;
uniform float uTime;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vViewPos;

const float TAU = 6.28318530718;

void main() {
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 world = wrapOrigin + mat3(modelMatrix) * position;
  float flowLen = length(waterFlow);
  float wet = clamp(waterDepth * 0.5, 0.0, 1.0);
  float rate = 1.0 + 3.0 * flowLen;
  // Three crossing swells in FIXED world directions: a swell along the flow creased at every piece joint.
  float swell = 0.06 * sin(world.x * TAU / ${glslFloat(SWELL_LONG)} + uTime * 1.1 * rate)
    + 0.05 * sin(world.z * TAU / ${glslFloat(SWELL_MID)} + uTime * 1.5 * rate)
    + 0.035 * (0.5 + 0.8 * flowLen) * sin((world.x + world.z) * TAU / ${glslFloat(SWELL_SHORT)} + uTime * 2.3 * rate);
  vec3 localUp = normalize(vec3(0.0, 1.0, 0.0) * mat3(modelMatrix));
  vec3 displaced = position + localUp * (swell * wet);
  vec3 worldQ = quantizeWorldPos(wrapOrigin + mat3(modelMatrix) * displaced);
  vViewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldQ - wrapOrigin);
  vDepth = waterDepth;
  vFlow = waterFlow;
  gl_Position = projectChunkLocal(displaced, normal);
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uNightBlend;
uniform vec2 ${LOD_FADE_UNIFORM};
uniform vec2 ${FAR_FADE_UNIFORM};
uniform vec3 uSunDir;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vViewPos;
varying vec3 vWorldPosWrapped;
varying float vFarDistance;

${SCREEN_DOOR_GLSL}
${LOD_FADE_GLSL}
${FAR_FADE_GLSL}
${commonShader}

/** One noise octave's height and gradient at q. */
vec3 octave(vec2 q, float scale) {
  float e = 0.5;
  float h = worldFbm(q, scale, 1);
  float gx = worldFbm(q + vec2(e, 0.0), scale, 1) - worldFbm(q - vec2(e, 0.0), scale, 1);
  float gz = worldFbm(q + vec2(0.0, e), scale, 1) - worldFbm(q - vec2(0.0, e), scale, 1);
  return vec3(gx / (2.0 * e), gz / (2.0 * e), h);
}

/** The three octaves (0.05, 0.09, 0.18; the finest's slope at 0.3, its height unused) sampled at three
 *  translated positions. A loop with ONE octave() call: every call site inlines five worldFbm, and the
 *  compile time grows with them (Firefox links on the main thread; 4 surfaceAt sites of 3 octaves each cost
 *  a 530ms link, PERFORMANCE.md). */
vec3 surfaceAt(vec2 q1, vec2 q2, vec2 q3) {
  vec3 sum = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 q = k == 0 ? q1 : (k == 1 ? q2 : q3);
    vec3 o = octave(q, k == 0 ? 0.05 : (k == 1 ? 0.09 : 0.18));
    sum += k == 2 ? vec3(0.3 * o.xy, 0.0) : o;
  }
  return sum;
}

void main() {
  if (vDepth <= 0.02) discard;
  if (lodFadeDiscards(${LOD_FADE_UNIFORM})) discard;
  if (farFadeDiscards(vFarDistance, ${FAR_FADE_UNIFORM})) discard;

  float flowLen = length(vFlow);
  vec2 flowDir = flowLen > 1e-4 ? vFlow / flowLen : vec2(1.0, 0.0);
  vec2 across = vec2(-flowDir.y, flowDir.x);

  // FALLS: the sheet's steepness from its screen-space normal, taken from the VIEW position (the
  // absolute position's float32 steps far from the origin read as per-pixel falls).
  vec3 faceN = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 viewDir = normalize(-vViewPos);
  if (dot(faceN, viewDir) < 0.0) faceN = -faceN;
  vec3 viewUp = viewMatrix[1].xyz;
  float fall = smoothstep(0.45, 0.8, 1.0 - abs(dot(faceN, viewUp)));

  // The branches only pick WHERE the surface is sampled (up to two phases, each three octave positions);
  // the one surfaceAt call below samples them (see surfaceAt on why one call site).
  vec2 q1;
  vec2 q2;
  vec2 q3;
  vec2 phase2 = vec2(0.0);
  float w1 = 1.0;
  float w2 = 0.0;
  if (fall > 0.5) {
    // The fall's frame: across the fall, and down it (world y), carried down with the water.
    vec2 q = vec2(dot(vWorldPosWrapped.xz, across), vWorldPosWrapped.y + uTime * ${glslFloat(ADVECT_DISTANCE / ADVECT_CYCLE)} * max(flowLen, 0.8));
    q1 = q;
    q2 = q * 1.3;
    q3 = q * 0.7;
  } else if (flowLen > 0.02) {
    // Advected along the flow in two phases cross-faded on a triangle wave: each restarts while the other
    // is whole. A translation of the wrapped position keeps the fbm's period across the wrap.
    float t1 = fract(uTime / ${glslFloat(ADVECT_CYCLE)});
    float t2 = fract(t1 + 0.5);
    w1 = 1.0 - abs(2.0 * t1 - 1.0);
    w2 = 1.0 - w1;
    vec2 p = vWorldPosWrapped.xz;
    q1 = p - flowDir * (${glslFloat(ADVECT_DISTANCE)} * flowLen * t1);
    q2 = q1;
    q3 = q1;
    phase2 = p - flowDir * (${glslFloat(ADVECT_DISTANCE)} * flowLen * t2) + 37.0;
  } else {
    // Still water: the octaves drift in three directions.
    vec2 p = vWorldPosWrapped.xz;
    float t = uTime * 0.4;
    q1 = p + vec2(1.0, 0.0) * t;
    q2 = p + vec2(-0.5, 0.87) * t;
    q3 = p + vec2(-0.5, -0.87) * t;
  }
  vec3 surf = vec3(0.0);
  for (int phase = 0; phase < 2; phase++) {
    if (phase == 1 && w2 <= 0.0) break;
    bool first = phase == 0;
    surf += surfaceAt(first ? q1 : phase2, first ? q2 : phase2, first ? q3 : phase2) * (first ? w1 : w2);
  }
  float rough = 0.35 + 0.45 * flowLen;
  vec2 slope = surf.xy * rough;

  vec3 nFlat = normalize(mat3(viewMatrix) * normalize(vec3(-slope.x, 1.0, -slope.y)));
  vec3 fallAcross = normalize(cross(faceN, viewUp));
  vec3 fallDown = cross(faceN, fallAcross);
  vec3 nFall = normalize(faceN - fallAcross * slope.x * 0.6 - fallDown * slope.y * 0.6);
  vec3 n = normalize(mix(nFlat, nFall, fall));

  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  float deep = smoothstep(0.0, 14.0, vDepth) * (1.0 - fall);
  vec3 color = mix(vec3(0.22, 0.62, 0.62), vec3(0.12, 0.2, 0.28), deep);
  color = mix(color, vec3(0.55, 0.7, 0.85), fresnel * 0.6);
  // Broad sparse pale streaks from the two coarse octaves under a soft threshold.
  float streaks = smoothstep(0.58, 1.0, surf.z);
  vec3 white = vec3(0.92, 0.96, 1.0);
  color = mix(color, white, 0.45 * flowLen * flowLen * streaks);
  color = mix(color, white, fall * (0.35 + 0.45 * streaks));
  vec3 sunView = normalize(mat3(viewMatrix) * uSunDir);
  color += pow(max(dot(reflect(-viewDir, n), sunView), 0.0), 80.0) * 0.6 * (1.0 - uNightBlend);

  float alpha = 0.55 + 0.35 * fresnel + 0.3 * fall;
  // A hard shore cut traced the LOD triangles.
  alpha *= smoothstep(0.0, 2.5, vDepth);
  alpha = min(alpha, 0.95);
  ${nightDimGLSL("color")}
  ${ditherGLSL("color")}
  gl_FragColor = vec4(color, alpha);
}
`;

/** The one clock every water mesh reads (advanced by the terrain renderer, tickWater). */
const WATER_CLOCK = { value: 0 };
export const tickWater = (elapsedSeconds: number): void => {
  WATER_CLOCK.value = elapsedSeconds;
};

let material: THREE.ShaderMaterial | null = null;

export const getWaterMaterial = (): THREE.ShaderMaterial => {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP), [FAR_FADE_DEFINE]: "" },
    uniforms: {
      uTime: WATER_CLOCK,
      uNightBlend: NIGHT_BLEND_UNIFORM,
      uSunDir: { value: SUN_DIRECTION.clone() },
      [LOD_FADE_UNIFORM]: { value: new THREE.Vector2(0, FADE_OPAQUE_HI) },
      [FAR_FADE_UNIFORM]: FAR_FADE_UNIFORMS[FAR_FADE_UNIFORM],
      ...CHUNK_PROJECTION_UNIFORMS,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return material;
};
