import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors/material";

/** The placeholder's look: blued steel and a walnut grip. */
let materials: { metal: THREE.Material; wood: THREE.Material; flash: THREE.SpriteMaterial } | null = null;

export const revolverMaterials = () => {
  if (materials) return materials;
  // Low metalness: the world has no environment map (as the MAV Unit's, mav-unit/material.ts).
  const metal = new THREE.MeshStandardMaterial({ color: "#3c4148", metalness: 0.35, roughness: 0.35, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: "#5b3720", metalness: 0, roughness: 0.7, flatShading: true });
  // Procedural geometry is off the quantization lattice.
  for (const m of [metal, wood]) prepareActorMaterial(m, { skipQuantization: true });
  const flash = new THREE.SpriteMaterial({ color: new THREE.Color(1, 0.85, 0.45), map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  materials = { metal, wood, flash };
  return materials;
};

/** A soft star: the flash's shape. */
const flashTexture = (): THREE.Texture => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.25, "rgba(255,220,140,0.9)");
  glow.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
};
