import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, NIGHT_GROUND_DIM } from "../lighting/dayNight";

/**
 * UNDERWATER: while the camera is under a water surface the scene renders into a target and a
 * full-screen pass draws it back blurred, wobbling and fogged toward the water's color by the
 * DEPTH BUFFER's distance — so every object class is covered without touching its material.
 *
 * The target is flagged `isXRRenderTarget` with an sRGB texture: three keys a program by the target's
 * output color space and tone mapping, and a plain target would give every material a second program,
 * all linked on the first dive (the terrain's alone takes ~1s under ANGLE). Flagged, every program is
 * the screen's own; the sRGB8 storage hands the pass back exactly what the screen would have shown.
 */

let cameraWaterDepth = 0;

/** How far the camera is under the water surface; ≤ 0 = above it. The Player writes it every frame. */
export const setCameraWaterDepth = (depth: number): void => {
  cameraWaterDepth = depth > 0 ? depth : 0;
};

export const isCameraUnderwater = (): boolean => cameraWaterDepth > 0;

/** 1/u: visibility ~ 1/density (at 60u the water hides ~85% of the scene). */
const FOG_DENSITY = 0.032;
/** Surface light fades with the camera's own depth over ~this many units. */
const LIGHT_FALLOFF_DEPTH = 25;

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

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
uniform mat4 uProjectionInverse;
uniform mat3 uCameraRotation;
varying vec2 vUv;

void main() {
  vec2 uv = vUv + vec2(sin(vUv.y * 38.0 + uTime * 1.7), cos(vUv.x * 31.0 + uTime * 1.3)) * 0.0016;
  float depth = texture2D(tDepth, uv).x;
  float dist = depth >= 1.0 ? 1e6 : -perspectiveDepthToViewZ(depth, uNear, uFar);
  float fog = 1.0 - exp(-dist * ${FOG_DENSITY.toFixed(4)});

  // Blur widens with the fog: near things stay readable, far ones smear into the water.
  vec2 r = uTexel * (1.2 + 3.5 * fog);
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
  vec3 water = mix(vec3(0.02, 0.09, 0.13), vec3(0.12, 0.38, 0.44), smoothstep(-0.4, 0.9, ray.y));
  water *= mix(0.3, 1.0, exp(-uCameraDepth / ${LIGHT_FALLOFF_DEPTH.toFixed(1)}));
  water *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);

  col = mix(col * vec3(0.6, 0.85, 0.9), water, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _size = new THREE.Vector2();

export class UnderwaterPass {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uTime: { value: 0 },
      uCameraDepth: { value: 0 },
      uNightBlend: NIGHT_BLEND_UNIFORM,
      uProjectionInverse: { value: new THREE.Matrix4() },
      uCameraRotation: { value: new THREE.Matrix3() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /** Links the pass's program now, not on the first dive. */
  warm(gl: THREE.WebGLRenderer): void {
    gl.compile(this.quadScene, this.quadCamera);
  }

  private targetFor(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    gl.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.floor(_size.x));
    const h = Math.max(1, Math.floor(_size.y));
    if (this.target && this.target.width === w && this.target.height === h) return this.target;
    this.target?.dispose();
    const target = new THREE.WebGLRenderTarget(w, h);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    target.depthTexture = new THREE.DepthTexture(w, h);
    (target as any).isXRRenderTarget = true;
    this.target = target;
    return target;
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const target = this.targetFor(gl);
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    const u = this.material.uniforms;
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
    u.uTexel.value.set(1 / target.width, 1 / target.height);
    const perspective = camera as THREE.PerspectiveCamera;
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;
    u.uTime.value = time;
    u.uCameraDepth.value = cameraWaterDepth;
    u.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    u.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
    gl.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
  }
}
