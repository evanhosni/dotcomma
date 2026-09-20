import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";

// One merged mesh per lamp: part colors baked as vertex colors, aLampMask (1 on the head)
// gates the emissive so the whole lamp is one draw call and one material.

import { LAMP_PARTS } from "./lampSpec";
export { LAMP_POLE_HEIGHT, LAMP_HEAD_OFFSET_X, LAMP_COLLIDER_DISTANCE, LAMP_PARTS, lampYaw } from "./lampSpec";

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
    const { pole, arm, head } = LAMP_PARTS;
    const box = (p: { w: number; h: number; d: number; x: number; y: number }) =>
      new THREE.BoxGeometry(p.w, p.h, p.d).translate(p.x, p.y, 0);
    lampPostGeometry = mergeGeometries([
      paintPart(new THREE.BoxGeometry(0.5, 0.35, 0.5).translate(0, 0.18, 0), DARK, 0), // base
      paintPart(box(pole), DARK, 0),
      paintPart(box(arm), DARK, 0),
      paintPart(box(head), 0xd8d3c2, 1),
    ]);
  }
  return lampPostGeometry;
};

/** Template — clone it through useDressingAssets. emissiveIntensity is driven by the night ramp. */
export const LAMP_POST_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  emissive: 0xffd166,
  emissiveIntensity: 0,
  roughness: 0.8,
  metalness: 0.05,
});

/** ASSIGNS onBeforeCompile (does not chain) — apply before patchers that chain, e.g. the
 *  dressing base's curvature prep. The fixed cache key keeps every clone on one program. */
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
