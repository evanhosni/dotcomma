import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM } from "../../lighting/day-night/material";
import { NIGHT_GROUND_DIM } from "../../lighting/day-night/constants";
import { WATER_DEFAULTS } from "../../generation/water/params";
import { SCREEN_QUAD_VERTEX_SHADER } from "./material";
import { ScreenFrame, ScreenPass } from "./types";
import { ScreenQuad } from "./ScreenQuad";
import type { LiquidLook, CameraWaterColors } from "./types";
import { isCameraUnderwater, cameraWaterDepth, cameraLook, cameraColors, UNDERWATER_MIX } from "./store";

/**
 * UNDERWATER: while the camera is under a water surface a full-screen pass (vfx/screen-pass/ScreenPassChain.ts) draws
 * the scene back blurred, wobbling and fogged toward the water's color by the DEPTH BUFFER's distance —
 * so every object class is covered without touching its material. Under a body of water with colours of
 * its own (a hot spring's turquoise) the look follows them (bodyLook).
 */

interface LookParams {
  /** The liquid's color looking down into the deep and up toward its lit surface. */
  deep: [number, number, number];
  lit: [number, number, number];
  /** What the liquid does to the scene's own colors. */
  tint: [number, number, number];
  /** 1/u: visibility ~ 1/density. */
  fogDensity: number;
  /** Blur radius multiplier. */
  blur: number;
}

const LOOKS: Record<LiquidLook, LookParams> = {
  // At 60u the water hides ~85% of the scene.
  water: { deep: [0.02, 0.09, 0.13], lit: [0.12, 0.38, 0.44], tint: [0.6, 0.85, 0.9], fogDensity: 0.032, blur: 1 },
  // Sewage: ~85% hidden by 20u.
  sewage: { deep: [0.04, 0.08, 0.01], lit: [0.24, 0.4, 0.06], tint: [0.45, 0.7, 0.25], fogDensity: 0.095, blur: 2.4 },
};

/** The water look under a body's own colours: LOOKS.water is the look of the <Water> defaults' colours, and
 *  each colour scales by the body's against those (as float32, the sheet's precision: the defaults' body
 *  is LOOKS.water exactly), the fog thickening as the body reaches its deep colour sooner. */
const BASE_SHALLOW = WATER_DEFAULTS.shallowColor.map(Math.fround);
const BASE_DEEP = WATER_DEFAULTS.deepColor.map(Math.fround);
const bodyLookScratch: LookParams = { deep: [0, 0, 0], lit: [0, 0, 0], tint: [0, 0, 0], fogDensity: 0, blur: 1 };
const bodyLook = ({ shallow, deep }: CameraWaterColors): LookParams => {
  const base = LOOKS.water;
  const out = bodyLookScratch;
  for (let c = 0; c < 3; c++) {
    const lit = shallow[c] / BASE_SHALLOW[c];
    out.lit[c] = base.lit[c] * lit;
    out.tint[c] = Math.min(1, base.tint[c] * lit);
    out.deep[c] = base.deep[c] * (deep[c] / BASE_DEEP[c]);
  }
  out.fogDensity = base.fogDensity * (Math.fround(WATER_DEFAULTS.deepDepth) / deep[3]);
  out.blur = base.blur;
  return out;
};

/** Surface light fades with the camera's own depth over ~this many units. */
const LIGHT_FALLOFF_DEPTH = 25;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uCameraDepth;
uniform float uNightBlend;
uniform vec3 uDeep;
uniform vec3 uLit;
uniform vec3 uTint;
uniform float uFogDensity;
uniform float uBlur;
uniform mat4 uProjectionInverse;
uniform mat3 uCameraRotation;
varying vec2 vUv;

void main() {
  vec2 uv = vUv + vec2(sin(vUv.y * 38.0 + uTime * 1.7), cos(vUv.x * 31.0 + uTime * 1.3)) * 0.0016;
  float depth = texture2D(tDepth, uv).x;
  float dist = depth >= 1.0 ? 1e6 : -perspectiveDepthToViewZ(depth, uNear, uFar);
  float fog = 1.0 - exp(-dist * uFogDensity);

  // Blur widens with the fog: near things stay readable, far ones smear into the water.
  vec2 r = uTexel * (1.2 + 3.5 * fog) * uBlur;
  vec3 col = texture2D(tColor, uv).rgb * 0.2;
  col += texture2D(tColor, uv + vec2( 1.0,  0.0) * r).rgb * 0.1;
  col += texture2D(tColor, uv + vec2(-1.0,  0.0) * r).rgb * 0.1;
  col += texture2D(tColor, uv + vec2( 0.0,  1.0) * r).rgb * 0.1;
  col += texture2D(tColor, uv + vec2( 0.0, -1.0) * r).rgb * 0.1;
  col += texture2D(tColor, uv + vec2( 0.7,  0.7) * r * 2.0).rgb * 0.1;
  col += texture2D(tColor, uv + vec2(-0.7,  0.7) * r * 2.0).rgb * 0.1;
  col += texture2D(tColor, uv + vec2( 0.7, -0.7) * r * 2.0).rgb * 0.1;
  col += texture2D(tColor, uv + vec2(-0.7, -0.7) * r * 2.0).rgb * 0.1;

  // The water is lit from above: brighter looking up, darker the deeper the camera.
  vec4 viewRay = uProjectionInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(uCameraRotation * (viewRay.xyz / viewRay.w));
  vec3 water = mix(uDeep, uLit, smoothstep(-0.4, 0.9, ray.y));
  water *= mix(0.3, 1.0, exp(-uCameraDepth / ${LIGHT_FALLOFF_DEPTH.toFixed(1)}));
  water *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);

  col = mix(col * uTint, water, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class UnderwaterPass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uTime: { value: 0 },
        uCameraDepth: { value: 0 },
        uNightBlend: NIGHT_BLEND_UNIFORM,
        uDeep: { value: new THREE.Vector3() },
        uLit: { value: new THREE.Vector3() },
        uTint: { value: new THREE.Vector3() },
        uFogDensity: { value: LOOKS.water.fogDensity },
        uBlur: { value: 1 },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uCameraRotation: { value: new THREE.Matrix3() },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );

  isActive(): boolean {
    return isCameraUnderwater();
  }

  warm(gl: THREE.WebGLRenderer): void {
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, _output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void {
    const u = this.quad.material.uniforms;
    u.tColor.value = frame.color;
    u.tDepth.value = frame.depth;
    u.uTexel.value.set(1 / frame.width, 1 / frame.height);
    const perspective = camera as THREE.PerspectiveCamera;
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;
    u.uTime.value = time;
    u.uCameraDepth.value = cameraWaterDepth;
    const look = cameraLook === "water" && cameraColors ? bodyLook(cameraColors) : LOOKS[cameraLook];
    u.uDeep.value.fromArray(look.deep);
    u.uLit.value.fromArray(look.lit);
    u.uTint.value.fromArray(look.tint);
    u.uFogDensity.value = look.fogDensity * UNDERWATER_MIX.fog;
    u.uBlur.value = look.blur * UNDERWATER_MIX.blur;
    u.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    u.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
    this.quad.draw(gl);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
