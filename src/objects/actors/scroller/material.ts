import * as THREE from "three";
import { prepareActorMaterial } from "../material";
import { SCROLLER_COLORS } from "./constants";

// Procedural geometry is off the quantization lattice (like the buildings'). Every paint shares one
// program: the materials differ only in their color uniform.
const createPaint = (color: string): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.45, metalness: 0.15 });
  prepareActorMaterial(material, { skipQuantization: true });
  return material;
};

export const SCROLLER_PAINTS: readonly THREE.MeshStandardMaterial[] = SCROLLER_COLORS.map(createPaint);

export const SCROLLER_WHEEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1c1c1f", flatShading: true, roughness: 0.9 });
prepareActorMaterial(SCROLLER_WHEEL_MATERIAL, { skipQuantization: true });
