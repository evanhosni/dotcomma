import * as THREE from "three";

const TEX_W = 1024;
const TEX_H = 256;

const BASE_FONT_PX = 112;
const FIT_PADDING = 48; // px of canvas left free on each side

const font = (px: number) => `${px}px 'Kode Mono', 'Courier New', Courier, monospace`;

const drawLabel = (ctx: CanvasRenderingContext2D, label: string) => {
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  // Auto-fit: shrink the font until the label fits the canvas
  ctx.font = font(BASE_FONT_PX);
  const baseWidth = ctx.measureText(label).width;
  const maxWidth = TEX_W - FIT_PADDING * 2;
  const size = baseWidth > maxWidth ? Math.floor((BASE_FONT_PX * maxWidth) / baseWidth) : BASE_FONT_PX;
  if (size !== BASE_FONT_PX) ctx.font = font(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, TEX_W / 2, TEX_H / 2 - size * 0.18);
};

/** CanvasTexture text label material (redrawn once webfonts load — Kode Mono
 *  is async; the first paint may have fallen back to Courier). Dispose both
 *  texture and material on unmount. */
export const makeLabelMaterial = (label: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  drawLabel(ctx, label);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  document.fonts?.ready.then(() => {
    drawLabel(ctx, label);
    texture.needsUpdate = true;
  });
  return { texture, material };
};
