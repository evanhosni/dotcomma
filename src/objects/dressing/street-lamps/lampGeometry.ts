import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";

/**
 * Street-lamp art: the merged low-poly post geometry and its material
 * template. Feature-owned (the lamp is DRESSING — see StreetLamps.tsx); the
 * lighting these feed lives in lighting/lampGlow.ts.
 *
 * ONE merged mesh per lamp (base + pole + arm + head): part colors are baked
 * as vertex colors, and an aLampMask attribute (1 on the head, 0 elsewhere)
 * gates the material's emissive so only the head glows — one draw call and
 * one material for the whole lamp instead of two of each.
 */

export const LAMP_POLE_HEIGHT = 10.8;
export const LAMP_ARM_X = 1.25; // lamp head offset along the arm
export const LAMP_COLLIDER_DISTANCE = 60;

/** Deterministic yaw from a lamp's position, so a lamp faces the same way on
 *  every load (and every chunk rebuild). */
export const lampYaw = (x: number, z: number): number => Math.abs(x * 7.13 + z * 3.71) % 6.283;

let lampPostGeometry: THREE.BufferGeometry | null = null;

const paintPart = (g: THREE.BufferGeometry, hex: number, lampMask: number): THREE.BufferGeometry => {
  const color = new THREE.Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const mask = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    mask[i] = lampMask;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aLampMask", new THREE.BufferAttribute(mask, 1));
  g.deleteAttribute("uv");
  return g;
};

export const getLampPostGeometry = (): THREE.BufferGeometry => {
  if (!lampPostGeometry) {
    const DARK = 0x2d3033;
    const H = LAMP_POLE_HEIGHT;
    lampPostGeometry = mergeGeometries([
      paintPart(new THREE.BoxGeometry(0.5, 0.35, 0.5).translate(0, 0.18, 0), DARK, 0), // base
      paintPart(new THREE.BoxGeometry(0.22, H, 0.22).translate(0, H / 2, 0), DARK, 0), // pole
      paintPart(new THREE.BoxGeometry(1.5, 0.18, 0.18).translate(0.65, H - 0.1, 0), DARK, 0), // arm
      paintPart(new THREE.BoxGeometry(0.85, 0.3, 0.45).translate(LAMP_ARM_X, H - 0.35, 0), 0xd8d3c2, 1), // head
    ]);
  }
  return lampPostGeometry;
};

/** Material template — cloned per chunk through the dressing base (which is
 *  what applies the shared material logic: curvature, disposal). Its
 *  emissiveIntensity is driven by the global window-lights ramp, so every lamp
 *  fades in together at nightfall and out together at dawn. */
export const LAMP_POST_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  emissive: 0xffd166,
  emissiveIntensity: 0,
  roughness: 0.8,
  metalness: 0.05,
});

/** Gate the emissive to the head via the aLampMask attribute. Every clone gets
 *  the same patch, and the fixed cache key keeps them all on one compiled
 *  program. NOTE: this ASSIGNS onBeforeCompile — apply it before any patcher
 *  that chains (the dressing base's material prep runs after, by construction). */
export const patchLampMask = (material: THREE.MeshStandardMaterial): void => {
  material.customProgramCacheKey = () => "lamp-post";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLampMask;\nvarying float vLampMask;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLampMask = aLampMask;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLampMask;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLampMask;",
      );
  };
};
