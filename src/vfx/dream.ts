import * as THREE from "three";
import { SCREEN_QUAD_VERTEX_SHADER, ScreenFrame, ScreenPass, ScreenQuad } from "./screenPass";

/**
 * DREAM: the early neural-net "deep dream" hallucination as one full-screen pass. No network runs —
 * it fakes the look from the image itself: colors are smeared ALONG the image's contours (a short
 * line-integral walk on the luminance gradient, bent by a drifting noise field), iridescent stripes
 * grow where the scene has detail, hues cycle with brightness and time, and the saturation is pushed
 * hard. Strength 0 = off, and the pass is skipped entirely.
 */

/** Live strength (0–1): <PostProcessing dream> sets it, devmode's slider drives it (vfx/tuning.ts). */
export const DREAM = { strength: 0 };

export const isDreaming = (): boolean => DREAM.strength > 0;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Rotation about the gray axis (Rodrigues): a hue shift that keeps luminance roughly in place.
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i).x;
  float b = hash2(i + vec2(1.0, 0.0)).x;
  float c = hash2(i + vec2(0.0, 1.0)).x;
  float d = hash2(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}

// Luminance gradient by forward differences, r texels wide.
vec2 gradientAt(vec2 uv, float centerLuma, float r) {
  float right = luma(texture2D(tColor, uv + vec2(uTexel.x * r, 0.0)).rgb);
  float up = luma(texture2D(tColor, uv + vec2(0.0, uTexel.y * r)).rgb);
  return vec2(right - centerLuma, up - centerLuma);
}

void main() {
  float s = uStrength;
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;

  vec3 original = texture2D(tColor, vUv).rgb;
  float l0 = luma(original);
  vec2 g0 = gradientAt(vUv, l0, 2.0);
  float detail = clamp(length(g0) * 6.0, 0.0, 1.0);

  // A slowly drifting warp field: everything breathes even where the image is flat.
  vec2 warp = vec2(fbm(p * 3.0 + t * 0.06), fbm(p * 3.0 + 5.2 - t * 0.05)) - 0.5;
  vec2 uv = vUv + warp * uTexel * 60.0 * s;

  // Line-integral walk along the contours: the smeared, combed, "painted by a network" texture.
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec3 c = texture2D(tColor, uv).rgb;
    acc += c;
    vec2 g = gradientAt(uv, luma(c), 2.0);
    vec2 tangent = vec2(-g.y, g.x) / (length(g) + 1e-3);
    vec2 dir = normalize(tangent + warp * 1.5 + 1e-4);
    uv += dir * uTexel * 3.0 * s;
  }
  vec3 col = acc / 6.0;

  // Chromatic fringe across the edges.
  vec2 fringe = normalize(g0 + 1e-4) * uTexel * 4.0 * s * detail;
  col.r = mix(col.r, texture2D(tColor, uv + fringe).r, 0.6);
  col.b = mix(col.b, texture2D(tColor, uv - fringe).b, 0.6);

  // Iridescent stripes combed along the gradient, strongest where the scene has detail.
  float l = luma(col);
  // Where the image is flat the gradient has no direction: the warp field steers instead of one fixed
  // diagonal.
  vec2 stripeDir = normalize(g0 * 40.0 + warp + 1e-4);
  float stripes = 0.5 + 0.5 * sin(dot(p, stripeDir) * 220.0 + l * 30.0 + fbm(p * 6.0) * 12.0 - t * 1.5);

  // Hue drifts in bands with brightness and the noise field — enough to go iridescent, not enough to
  // lose what the scene is.
  float hue = l * 4.0 + fbm(p * 4.0) * 2.5 + t * 0.15;
  vec3 dream = hueRotate(col, hue * s * 0.45);
  dream *= mix(1.0, 0.7 + 0.6 * stripes, mix(0.12, 1.0, detail) * s);

  // Oversaturate and add punchy contrast.
  float dl = luma(dream);
  dream = mix(vec3(dl), dream, 1.0 + 1.6 * s);
  dream = mix(dream, smoothstep(0.0, 1.0, dream), 0.6 * s);

  gl_FragColor = vec4(clamp(mix(original, dream, smoothstep(0.0, 0.35, s)), 0.0, 1.0), 1.0);
}
`;

export class DreamPass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uStrength: { value: 0 },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );

  isActive(): boolean {
    return isDreaming();
  }

  warm(gl: THREE.WebGLRenderer): void {
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, _output: THREE.WebGLRenderTarget | null, _camera: THREE.Camera, time: number): void {
    const u = this.quad.material.uniforms;
    u.tColor.value = frame.color;
    u.uTexel.value.set(1 / frame.width, 1 / frame.height);
    u.uAspect.value = frame.width / frame.height;
    u.uTime.value = time;
    u.uStrength.value = DREAM.strength;
    this.quad.draw(gl);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
