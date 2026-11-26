import * as THREE from "three";
import type { BoneShape, SkeletonLayout } from "./types";

const layouts = new WeakMap<THREE.BufferGeometry, SkeletonLayout>();
const _vertex = new THREE.Vector3();

/** Which bone each vertex follows most, and where it sits in that bone's space at the bind pose: the shape
 *  of every bone (a ragdoll's parts, a MAV Unit's seat on a head), read from any skinned model. Cached per
 *  geometry, which every clone of a model shares. */
export const skeletonLayoutOf = (root: THREE.Object3D): SkeletonLayout | null => {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) meshes.push(mesh);
  });
  if (meshes.length === 0) return null;
  const cached = layouts.get(meshes[0].geometry);
  if (cached) return cached;

  const shapes = new Map<string, BoneShape>();
  const modelToBone = new Map<string, THREE.Matrix4>();
  for (const mesh of meshes) {
    const { skeleton, geometry } = mesh;
    // Mesh space → each bone's space at the bind pose (the inverse of what skinning applies).
    const meshToBone = skeleton.bones.map((_, i) => new THREE.Matrix4().multiplyMatrices(skeleton.boneInverses[i], mesh.bindMatrix));
    // bindMatrixInverse is the clone's model space → this mesh's space (model/store.ts freezes it so).
    skeleton.bones.forEach((bone, i) => {
      if (!modelToBone.has(bone.name)) modelToBone.set(bone.name, meshToBone[i].clone().multiply(mesh.bindMatrixInverse));
    });

    const position = geometry.getAttribute("position");
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) continue;
    for (let i = 0; i < position.count; i++) {
      let best = -1;
      let bestWeight = 0;
      for (let c = 0; c < 4; c++) {
        const weight = skinWeight.getComponent(i, c);
        if (weight > bestWeight) {
          bestWeight = weight;
          best = skinIndex.getComponent(i, c);
        }
      }
      const bone = skeleton.bones[best];
      if (!bone) continue;
      let shape = shapes.get(bone.name);
      if (!shape) shapes.set(bone.name, (shape = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), vertices: 0 }));
      _vertex.fromBufferAttribute(position, i).applyMatrix4(meshToBone[best]);
      shape.min.min(_vertex);
      shape.max.max(_vertex);
      shape.vertices++;
    }
  }

  const layout: SkeletonLayout = { shapes, modelToBone };
  layouts.set(meshes[0].geometry, layout);
  return layout;
};

/** The bone named `name` under `root`. */
export const boneNamed = (root: THREE.Object3D, name: string): THREE.Bone | undefined => {
  let found: THREE.Bone | undefined;
  root.traverse((node) => {
    if (!found && (node as THREE.Bone).isBone && node.name === name) found = node as THREE.Bone;
  });
  return found;
};
