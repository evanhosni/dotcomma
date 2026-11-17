import * as THREE from "three";

/** Template for createLampPostMaterial. emissiveIntensity is driven by the night ramp. */
const LAMP_POST_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  emissive: 0xffd166,
  emissiveIntensity: 0,
  roughness: 0.8,
  metalness: 0.05,
});

/** ASSIGNS onBeforeCompile (does not chain) — apply before patchers that chain, e.g. the
 *  dressing base's curvature prep. The fixed cache key keeps every clone on one program. */
const patchLampMask = (material: THREE.MeshStandardMaterial): void => {
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

/** A lamp-post material: the template with the head-only emissive mask. Create it inside
 *  useChunkAssets (which adds curvature and the spawn fade on top). */
export const createLampPostMaterial = (): THREE.MeshStandardMaterial => {
  const material = LAMP_POST_MATERIAL.clone();
  patchLampMask(material);
  return material;
};
