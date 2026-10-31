import * as THREE from "three";
import type { MaterialData } from "../../../types";
import gridFragmentShader from "../shaders/fragment.glsl";
import { CRT_GLOW, CRT_POSITION } from "./constants";

/** 0 → 1 as the CRT powers on. SHARED by the screen and the home grid's glow (home/shaders/fragment.glsl),
 *  which reads it as `uCrtPower` through the terrain material. */
export const CRT_POWER = { value: 0 };

const SCREEN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The noise grain: this many cells across the 4:3 screen, reshuffled STATIC_FPS times a second.
const SCREEN_FRAGMENT_SHADER = `
  uniform float uPower;
  uniform float uTime;
  uniform float uHover;
  varying vec2 vUv;

  const vec2 GRAIN = vec2(160.0, 120.0);
  const float STATIC_FPS = 24.0;

  float hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    // Barrel curvature
    vec2 c = vUv * 2.0 - 1.0;
    c *= 1.0 + 0.06 * dot(c, c);
    vec2 uv = c * 0.5 + 0.5;

    vec3 col = vec3(0.0);
    float dy = abs(uv.y - 0.5);

    // CRT power-on: the picture opens from a horizontal line
    float open = smoothstep(0.0, 0.6, uPower);
    float halfH = 0.5 * open;

    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 && uPower > 0.001 && dy < halfH) {
      float frame = floor(uTime * STATIC_FPS);
      float snow = hash(vec3(floor(uv * GRAIN), frame));
      col = vec3(snow * snow * 0.85);

      // Scanlines, rolling band, flicker, vignette
      col *= 0.85 + 0.15 * sin(uv.y * 3.14159 * 220.0);
      float band = fract(uv.y + uTime * 0.06);
      col += vec3(0.05) * smoothstep(0.18, 0.0, abs(band - 0.5));
      col *= 0.96 + 0.04 * sin(uTime * 97.0);
      col *= 1.0 - 0.35 * pow(dot(c, c), 1.5);

      col *= 1.0 + 0.25 * uHover;
    }

    // Bright line at the opening edge while powering on
    col += vec3(0.8) * (1.0 - open) * step(0.001, uPower) * smoothstep(halfH + 0.04, halfH, dy);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The screen: TV static, with barrel curvature, scanlines, flicker and the power-on line. Caller disposes it. */
export const createScreenMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uPower: CRT_POWER,
      uTime: { value: 0 },
      uHover: { value: 0 },
    },
    vertexShader: SCREEN_VERTEX_SHADER,
    fragmentShader: SCREEN_FRAGMENT_SHADER,
  });

/** The home grid's <Material getMaterial>: its lines lit by the CRT's glow (home/shaders/fragment.glsl). */
export const crtLitGridMaterial = async (): Promise<MaterialData> => {
  const color = new THREE.Color(CRT_GLOW.color);
  const [ox, oy, oz] = CRT_GLOW.offset;
  return {
    uniforms: {
      uCrtPower: CRT_POWER,
      uCrtLight: { value: new THREE.Vector3(CRT_POSITION[0] + ox, CRT_POSITION[1] + oy, CRT_POSITION[2] + oz) },
      uCrtGlow: { value: new THREE.Vector4(color.r, color.g, color.b, CRT_GLOW.intensity) },
      uCrtGlowDistance: { value: CRT_GLOW.distance },
    },
    fragmentShader: gridFragmentShader,
  };
};
