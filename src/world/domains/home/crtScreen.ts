import * as THREE from "three";
import { fontOfSize } from "../../../menus/overlay/styles";

// The CRT's picture: a canvas text atlas (one 4:3 row per page) and the screen shader that scrolls
// through it over the diorama thumbnail, with barrel curvature, scanlines, flicker and power-on.

/** One screen page. Without `href` it renders as locked. */
export interface CrtPage {
  label: string;
  href?: string;
}

// Text atlas: one row per page, top to bottom.
const ATLAS_W = 512;
const ATLAS_ROW_H = 384; // 4:3, matches the screen so text isn't stretched

const drawAtlas = (ctx: CanvasRenderingContext2D, pages: readonly CrtPage[]) => {
  const pageCount = pages.length;
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_ROW_H * pageCount);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  const text = (str: string, x: number, y: number) => {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };
  pages.forEach((page, i) => {
    const top = i * ATLAS_ROW_H;
    ctx.fillStyle = "#00ff00";
    if (page.href) {
      ctx.font = fontOfSize(44);
      text(page.label, ATLAS_W / 2, top + 62);
      ctx.font = fontOfSize(20);
      ctx.fillStyle = "#00dd44";
      text("click to enter", ATLAS_W / 2, top + 356);
    } else {
      ctx.fillStyle = "#1d6b2f";
      ctx.font = fontOfSize(84);
      text(page.label, ATLAS_W / 2, top + 186);
      ctx.font = fontOfSize(20);
      text("locked", ATLAS_W / 2, top + 246);
    }
    ctx.fillStyle = "#0a9a34";
    ctx.font = fontOfSize(18);
    ctx.textAlign = "right";
    text(`${i + 1} / ${pageCount}`, ATLAS_W - 18, top + ATLAS_ROW_H - 16);
    ctx.textAlign = "center";
  });
};

const SCREEN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const screenFragmentShader = (pageCount: number) => `
  uniform sampler2D uAtlas;
  uniform sampler2D uWorld;
  uniform float uScroll; // page units, 0..PAGES-1
  uniform float uPower;
  uniform float uTime;
  uniform float uHover;
  varying vec2 vUv;

  const float PAGES = ${pageCount}.0;

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
      float cy = 0.5 + (uv.y - 0.5) / max(open, 0.001);

      float cv = (1.0 - cy) + uScroll;
      float page = floor(cv);
      float ly = fract(cv);

      // Raster glow: the tube reads as "on" where nothing is drawn
      col = vec3(0.010, 0.028, 0.014);

      if (page >= -0.5 && page < PAGES - 0.5) {
        if (page < 0.5) {
          vec3 world = texture2D(uWorld, vec2(uv.x, 1.0 - ly)).rgb;
          col = pow(world, vec3(0.4545)) * 0.9; // linear bake -> display, dimmed a touch for text contrast
        }

        vec2 auv = vec2(uv.x, 1.0 - (page + ly) / PAGES);
        vec4 text = texture2D(uAtlas, auv);
        col = mix(col, text.rgb, text.a);
      }

      // Scanlines, rolling band, flicker, vignette
      col *= 0.85 + 0.15 * sin(uv.y * 3.14159 * 220.0);
      float band = fract(uv.y + uTime * 0.06);
      col += vec3(0.010, 0.030, 0.016) * smoothstep(0.18, 0.0, abs(band - 0.5));
      col *= 0.96 + 0.04 * sin(uTime * 97.0);
      col *= 1.0 - 0.35 * pow(dot(c, c), 1.5);

      col *= 1.0 + 0.15 * uHover;
    }

    // Bright line at the opening edge while powering on
    col += vec3(0.7, 1.0, 0.8) * (1.0 - open) * step(0.001, uPower) * smoothstep(halfH + 0.04, halfH, dy);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The screen's atlas texture and material for these pages. The atlas redraws once the web font has
 *  loaded. Caller disposes both. */
export const createCrtScreen = (pages: readonly CrtPage[]): { atlasTexture: THREE.CanvasTexture; screenMaterial: THREE.ShaderMaterial } => {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_ROW_H * pages.length;
  const ctx = canvas.getContext("2d")!;
  drawAtlas(ctx, pages);
  const atlasTexture = new THREE.CanvasTexture(canvas);
  document.fonts?.ready.then(() => {
    drawAtlas(ctx, pages);
    atlasTexture.needsUpdate = true;
  });
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlasTexture },
      uWorld: { value: null as THREE.Texture | null },
      uScroll: { value: 0 },
      uPower: { value: 0 },
      uTime: { value: 0 },
      uHover: { value: 0 },
    },
    vertexShader: SCREEN_VERTEX_SHADER,
    fragmentShader: screenFragmentShader(pages.length),
  });
  return { atlasTexture, screenMaterial };
};
