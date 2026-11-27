import * as THREE from "three";
import { prepareActorMaterial } from "../material";

/** One per quantization grid (model/store.ts bakes a clone's grid into its materials): the caps' vertices are
 *  the cut skin's, so they must snap to the same lattice or the seam between them opens. */
const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The inside of a sliced body: wet, dark flesh over every cut (slices/geometry.ts caps), both faces (a cap
 * is seen from either side as its piece tumbles), skinned with the body. Built on the actor base, on the
 * body's own quantization grid.
 */
export const fleshMaterial = (quantization: number | undefined): THREE.MeshStandardMaterial => {
  const key = `${quantization ?? "global"}`;
  let material = materials.get(key);
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ color: "#7a0c14", emissive: "#2c0306", roughness: 0.4, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  // As the bodies' own (model/store.ts): actors are drawn without fog.
  material.fog = false;
  material.name = "flesh";
  prepareActorMaterial(material, { quantization });
  materials.set(key, material);
  return material;
};

/** The flesh's programs as a model's sliced meshes will draw them: one template per skinned mesh of the
 *  clone, on its own geometry and skeleton (the program keys on its skinning AND its morph targets), for the
 *  model's load-time warm-up (ModelActor.Warmup). A cut must never link a program mid-play: the hitch is a
 *  long physics step, and the pieces fall through the ground. */
export const fleshTemplatesOf = (scene: THREE.Object3D, quantization: number | undefined): THREE.SkinnedMesh[] => {
  const templates: THREE.SkinnedMesh[] = [];
  scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const template = new THREE.SkinnedMesh(mesh.geometry, fleshMaterial(quantization));
    template.bind(mesh.skeleton, mesh.bindMatrix);
    templates.push(template);
  });
  return templates;
};
