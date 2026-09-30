import * as THREE from "three";
import { createFoliage } from "../Foliage";

// A plant type is only its art and its defaults; the pipeline is ../Foliage.tsx. Copy this
// file for a shrub or fern — different billboard, different seed.

let bladeTexture: THREE.CanvasTexture | null = null;

/** Near-white so `color` defines the tint. Module-level: the base keys its material on this
 *  function's identity. */
const getBladeTexture = (): THREE.CanvasTexture => {
  if (bladeTexture) return bladeTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "#a8a8a8");
  grad.addColorStop(1, "#ffffff");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(6, 128);
  ctx.quadraticCurveTo(9, 50, 16, 4);
  ctx.quadraticCurveTo(23, 50, 26, 128);
  ctx.closePath();
  ctx.fill();

  bladeTexture = new THREE.CanvasTexture(canvas);
  bladeTexture.colorSpace = THREE.SRGBColorSpace;
  return bladeTexture;
};

export const GrassField = createFoliage({
  // No other plant type may reuse this seed (same seed + density = same points).
  seed: "grass",
  texture: getBladeTexture,
  color: "#6a9c45",
  density: 800_000,
  width: 0.12,
  height: 1.2,
  sway: 0.15,
  swaySpeed: 1.2,
  slopeRange: [0, 35],
  slopeBlend: 10,
  renderDistance: 500,
});
