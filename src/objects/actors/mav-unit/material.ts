import * as THREE from "three";
import { prepareActorMaterial } from "../material";

/** The placeholder's look until its GLB exists: brushed metal, a dark scanner window, a glowing antenna tip
 *  in the scan's own phosphor (vfx/screen-pass/ScanPass.ts HOT). */
let materials: { body: THREE.Material; screw: THREE.Material; trim: THREE.Material; window: THREE.Material; bulb: THREE.Material } | null = null;

export const mavMaterials = () => {
  if (materials) return materials;
  // Low metalness: the world has no environment map, so a true metal reflects nothing and reads black.
  const body = new THREE.MeshStandardMaterial({ color: "#c3cad3", metalness: 0.3, roughness: 0.35 });
  const screw = new THREE.MeshStandardMaterial({ color: "#a2a9b2", metalness: 0.35, roughness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: "#5b636d", metalness: 0.3, roughness: 0.5 });
  const window = new THREE.MeshStandardMaterial({ color: "#071416", emissive: "#2f8f80", emissiveIntensity: 0.5, metalness: 0.1, roughness: 0.08 });
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.0, 0.86) });
  // Procedural geometry is off the quantization lattice; an unlit bulb has no irradiance to glow.
  for (const m of [body, screw, trim, window]) prepareActorMaterial(m, { skipQuantization: true });
  prepareActorMaterial(bulb, { skipQuantization: true, skipLampGlow: true });
  materials = { body, screw, trim, window, bulb };
  return materials;
};
