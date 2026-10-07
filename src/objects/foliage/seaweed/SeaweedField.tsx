import * as THREE from "three";
import { createFoliage } from "../Foliage";

// A plant type is only its art and its defaults; the pipeline is ../Foliage.tsx.

let ribbonTexture: THREE.CanvasTexture | null = null;

/** A long, wavy-edged ribbon, near-white so `color` defines the tint. Module-level: the base keys
 *  its material on this function's identity. */
const getRibbonTexture = (): THREE.CanvasTexture => {
  if (ribbonTexture) return ribbonTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "#8a8a8a");
  grad.addColorStop(1, "#ffffff");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(10, 256);
  for (let y = 256; y >= 8; y -= 16) ctx.lineTo(9 + Math.sin(y * 0.09) * 4, y);
  ctx.quadraticCurveTo(16, 0, 23, 8);
  for (let y = 8; y <= 256; y += 16) ctx.lineTo(23 + Math.sin(y * 0.09 + 1.3) * 4, y);
  ctx.closePath();
  ctx.fill();

  ribbonTexture = new THREE.CanvasTexture(canvas);
  ribbonTexture.colorSpace = THREE.SRGBColorSpace;
  return ribbonTexture;
};

export const SeaweedField = createFoliage({
  // No other plant type may reuse this seed (same seed + density = same points).
  seed: "seaweed",
  texture: getRibbonTexture,
  color: "#6fbf52",
  density: 60_000,
  width: 0.6,
  height: 7,
  sway: 1.6,
  swaySpeed: 0.5,
  slopeRange: [0, 40],
  slopeBlend: 10,
  renderDistance: 260,
  underwater: true,
});
