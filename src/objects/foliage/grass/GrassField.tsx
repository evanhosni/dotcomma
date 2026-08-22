import * as THREE from "three";
import { createFoliage } from "../Foliage";

/**
 * GRASS — the first foliage type. Everything that makes a field work (chunk
 * streaming, the instanced billboard mesh, the sway/billboard/fade shader, the
 * distance LOD, world curvature, quantization) lives in the FOLIAGE base
 * (../Foliage.tsx); a plant type is only its art and its defaults, and every
 * knob stays overridable at the mount:
 *
 *   <Foliage renderDistance={1000}>
 *     <GrassField density={8_000_000} color="#6fff00" height={1.3} sway={0.5} />
 *   </Foliage>
 *
 * A shrub, a fern, a wheat field: copy this file, draw a different billboard,
 * pick a different seed. There is no pipeline to duplicate.
 */

let bladeTexture: THREE.CanvasTexture | null = null;

/** Procedurally drawn tapered grass blade — near-white so `color` defines the
 *  tint. Module-level and cached: the base keys its material on this
 *  function's identity, and every grass field shares the one texture. */
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
  // "grass" is this type's placement seed — changing it moves every blade in
  // the world, and no other plant type may reuse it (same seed + density =
  // same points, so the two fields would grow through each other).
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
