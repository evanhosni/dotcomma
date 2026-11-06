import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, NIGHT_GROUND_DIM } from "../lighting/dayNight";
import type { LiquidLook } from "../utils/workers/underground/tunnelSpace";
import { SCREEN_QUAD_VERTEX_SHADER, ScreenFrame, ScreenPass, ScreenQuad } from "./screenPass";

/**
 * UNDERWATER: while the camera is under a water surface a full-screen pass (vfx/screenPass.ts) draws
 * the scene back blurred, wobbling and fogged toward the water's color by the DEPTH BUFFER's distance —
 * so every object class is covered without touching its material.
 */

let cameraWaterDepth = 0;

/** What a liquid looks like from under it: the water's blue, or the sewers' green sewage — thicker
 *  (a third of the water's visibility) and blurrier. */
export type { LiquidLook };

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

let cameraLook: LiquidLook = "water";

/** How far the camera is under a liquid surface (≤ 0 = above it) and which liquid. The Player writes
 *  it every frame. */
export const setCameraWaterDepth = (depth: number, look: LiquidLook = "water"): void => {
  cameraWaterDepth = depth > 0 ? depth : 0;
  cameraLook = look;
};

export const isCameraUnderwater = (): boolean => cameraWaterDepth > 0;

/** Devmode's live mixes over every liquid's fog density and blur (vfx/tuning.ts); 1 = as designed. */
export const UNDERWATER_MIX = { fog: 1, blur: 1 };

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
    const look = LOOKS[cameraLook];
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
