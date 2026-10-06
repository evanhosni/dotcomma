import type * as THREE from "three";

type ShaderPatch = (...args: Parameters<THREE.Material["onBeforeCompile"]>) => void;

/** Adds `patch` to the material's shader WITHOUT losing the patches already on it: it CHAINS
 *  onBeforeCompile (assigning silently discards another patcher's edits — quantization once dropped the
 *  lamp glow's) and appends `cacheKeySuffix` to the program cache key (a patched shader is another
 *  program). Every material patcher (curvature, quantization, spawn fade, lamp glow) goes through here. */
export const chainMaterialPatch = (material: THREE.Material, cacheKeySuffix: string, patch: ShaderPatch): void => {
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (previousCacheKey?.() ?? "") + cacheKeySuffix;

  const previousPatch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousPatch?.call(material, shader, renderer);
    patch(shader, renderer);
  };

  material.needsUpdate = true;
};
