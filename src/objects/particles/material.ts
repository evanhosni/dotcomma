import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../../world/shaders/chunkProjection";
import { glslFloat, WORLD_WRAP } from "../../world/shaders/constants";

/**
 * THE PARTICLE BASE (CLAUDE.md "The three game-object classes" → particles): mass, stateless, LOOPING
 * GPU particles any system can draw. Nothing is simulated on the CPU: every particle is an instance of a
 * unit quad with its own origin, velocity, life, phase, size and seed, and the vertex shader places it by
 * its age (`(time − phase) mod life`). A frame costs one clock uniform. The LOD is in the shader: every
 * particle within LOD_NEAR, a share falling to LOD_FAR_SHARE by LOD_FAR (each particle's seed decides, so
 * the same ones stay), the survivors growing LOD_FAR_SCALE× so a far fall still reads as white water.
 */

export interface ParticleLook {
  color: [number, number, number];
  opacity: number;
  /** u/s², along world y. */
  gravity: number;
  wobble: { amplitude: number; rate: number };
  /** A bright centre (spray), a bright rim with a highlight and a see-through middle (a bubble), or a
   *  wide featureless haze that fades in slowly and out over half its life (mist). */
  style: "spray" | "bubble" | "mist";
}

export const SPLASH_LOOK: ParticleLook = { color: [0.92, 0.94, 0.97], opacity: 0.7, gravity: -14, wobble: { amplitude: 0, rate: 0 }, style: "spray" };
export const BUBBLE_LOOK: ParticleLook = { color: [0.75, 0.88, 1.0], opacity: 0.6, gravity: 0, wobble: { amplitude: 0.12, rate: 3.2 }, style: "bubble" };
/** The mist hanging over white water: a few large, faint, slow quads per emitter, drifting with the air. */
export const MIST_LOOK: ParticleLook = { color: [0.93, 0.95, 0.98], opacity: 0.22, gravity: 0, wobble: { amplitude: 0.6, rate: 0.7 }, style: "mist" };

const STYLE_INDEX: Record<ParticleLook["style"], number> = { spray: 0, bubble: 1, mist: 2 };

const LOD_NEAR = 120;
const LOD_FAR = 900;
const LOD_FAR_SHARE = 0.12;
const LOD_FAR_SCALE = 2.2;

/** The one clock (seconds) every particle material reads; written once per frame by whoever calls first. */
const PARTICLE_CLOCK = { value: 0 };
export const tickParticles = (elapsedSeconds: number): void => {
  PARTICLE_CLOCK.value = elapsedSeconds;
};

const PARTICLE_VERTEX = /* glsl */ `
${CHUNK_PROJECTION_GLSL}
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute float aLife;
attribute float aPhase;
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uGravity;
uniform vec2 uWobble;
varying vec2 vUv;
varying float vAge;
varying float vSeed;

void main() {
  float age = mod(uTime - aPhase, aLife);
  vAge = age / aLife;
  vSeed = aSeed;
  vUv = uv;
  vec3 wobble = uWobble.x * vec3(sin(uTime * uWobble.y + aSeed * 6.2832), 0.0, cos(uTime * uWobble.y * 0.8 + aSeed * 12.566));
  vec3 local = aOrigin + aVelocity * age + vec3(0.0, 0.5 * uGravity * age * age, 0.0) + wobble;
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * local;
  vec3 world = quantizeWorldPos(wrapOrigin + localWorld);
  vWorldPosWrapped = world;
  vWorldPosAbs = chunkOrigin + localWorld;
  vWorldNormal = vec3(0.0, 1.0, 0.0);
  vec3 viewCenter = modelViewMatrix[3].xyz + mat3(viewMatrix) * (world - wrapOrigin);
  float far = smoothstep(${glslFloat(LOD_NEAR)}, ${glslFloat(LOD_FAR)}, length(viewCenter));
  float size = aSize * mix(1.0, ${glslFloat(LOD_FAR_SCALE)}, far);
  // Billboarded in VIEW space, then curved: the offset follows the curve.
  vec3 viewPos = viewCenter + vec3(position.xy * size, 0.0);
  vFarDistance = farFadeDistance(viewPos);
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
  // A dropped particle collapses off screen (no per-frame instance counts).
  if (aSeed > mix(1.0, ${glslFloat(LOD_FAR_SHARE)}, far)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uNightBlend;
uniform float uStyle;
varying vec2 vUv;
varying float vAge;
varying float vSeed;

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float ang = atan(c.y, c.x);
  // A ragged soft disc: the edge wobbles by the seed, so no two drops are the same round dot.
  float edge = 0.92 - 0.1 * sin(ang * 5.0 + vSeed * 40.0) - 0.06 * sin(ang * 9.0 - vSeed * 70.0);
  float disc = 1.0 - smoothstep(edge - 0.35, edge, r);
  float life = smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.7, 1.0, vAge));
  if (uStyle > 1.5) {
    // Mist: a featureless haze, densest at its middle, grown in over a quarter of its life and
    // thinned away over the last half (it never pops).
    disc = (1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - 0.5 * r);
    life = smoothstep(0.0, 0.25, vAge) * (1.0 - smoothstep(0.5, 1.0, vAge));
  }
  float alpha = disc * life * uOpacity;
  vec3 color = uColor;
  if (uStyle < 0.5) {
    color *= 1.0 + 0.4 * (1.0 - r);
  } else if (uStyle < 1.5) {
    float rim = smoothstep(0.45, 0.85, r / edge);
    float spot = 1.0 - smoothstep(0.0, 0.25, length(c - vec2(-0.35, 0.35)));
    alpha *= mix(0.12, 1.0, rim) + spot;
    color += spot * 0.5;
  }
  if (alpha < 0.01) discard;
  ${nightDimGLSL("color")}
  ${ditherGLSL("color")}
  gl_FragColor = vec4(color, alpha);
}
`;

/** A look's material: transparent, no depth write, no tone mapping; shares the clock and the chunk projection. */
export const createParticleMaterial = (look: ParticleLook): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP) },
    uniforms: {
      uTime: PARTICLE_CLOCK,
      uNightBlend: NIGHT_BLEND_UNIFORM,
      uColor: { value: new THREE.Vector3(...look.color) },
      uOpacity: { value: look.opacity },
      uGravity: { value: look.gravity },
      uWobble: { value: new THREE.Vector2(look.wobble.amplitude, look.wobble.rate) },
      uStyle: { value: STYLE_INDEX[look.style] },
      ...CHUNK_PROJECTION_UNIFORMS,
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
