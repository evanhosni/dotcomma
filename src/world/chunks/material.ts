import * as THREE from "three";
import { _curvature } from "../../vfx/material";
import { _spawnFade } from "../../vfx/spawn-fade";

export const prepareChunkMaterial = (material: THREE.Material): void => {
  _curvature.patchMaterial(material);
  _spawnFade.patchMaterial(material);
};

/** A feature's own ShaderMaterial in a holder: it carries the chunk projection (quantization, curvature:
 *  world/shaders/material.ts) itself, so `useChunkAssets` disposes it but does not patch it
 *  again; only the spawn fade — the one effect the projection does not carry — is applied here. */
export interface SelfPatchedMaterial<M extends THREE.Material = THREE.ShaderMaterial> {
  material: M;
  dispose: () => void;
}
export const selfPatchedMaterial = <M extends THREE.Material>(material: M): SelfPatchedMaterial<M> => {
  _spawnFade.patchMaterial(material);
  return { material, dispose: () => material.dispose() };
};
