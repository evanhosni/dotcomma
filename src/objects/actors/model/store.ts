// Pool of prepared GLTF clones keyed by (model | quantization override).
// Pools survive domain switches (clones are domain-agnostic); the override is
// part of the key because it is BAKED into the materials, while no-override
// materials follow the live global uniform. Geometry is shared with the
// source GLTF and never disposed here.
import * as THREE from "three";
import { uploadOnFirstDraw } from "../../../utils/render/utils";
import { prepareActorMaterial } from "../material";
import type { PooledModelClone } from "./types";
import { RootRelativeSkeleton, updateMatrixWorldKeepBind, applyBoneTransformRootRelative } from "./RootRelativeSkeleton";
import { mergeSkinnedSiblings } from "./geometry";
import { SKINNED_BOUNDS_PAD, MAX_POOLED_PER_KEY } from "./constants";

const pools = new Map<string, PooledModelClone[]>();

/** userData flag of an object hung on a pooled model's bones from outside it (a MAV Unit on a head): the pool
 *  takes it off before the clone is reused, so the next actor never inherits it. */
export const ATTACHMENT_FLAG = "attachment";

const stripAttachments = (root: THREE.Object3D): void => {
  const found: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node !== root && node.userData[ATTACHMENT_FLAG]) found.push(node);
  });
  for (const node of found) node.removeFromParent();
};

// Materials and skeletons are deduped by SOURCE object: beeble.glb has 10
// skinned meshes on ONE skeleton, and a skeleton per mesh meant 10×
// Skeleton.update() + 10 bone-texture uploads per instance per frame.
function cloneModelWithAnimations(gltf: any): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  skinnedMeshes: THREE.SkinnedMesh[];
} {
  const scene: THREE.Group = gltf.scene.clone(true);
  const animations: THREE.AnimationClip[] = gltf.animations ?? [];

  const skinnedMeshes: Record<string, THREE.SkinnedMesh> = {};
  gltf.scene.traverse((node: any) => {
    if (node.isSkinnedMesh) {
      skinnedMeshes[node.name] = node as THREE.SkinnedMesh;
    }
  });

  const clonedBones = new Map<string, THREE.Bone>();
  const clonedSkinned: THREE.SkinnedMesh[] = [];

  const materialCloneMap = new Map<THREE.Material, THREE.Material>();
  const cloneMaterialShared = (mat: THREE.Material): THREE.Material => {
    let cloned = materialCloneMap.get(mat);
    if (!cloned) {
      cloned = mat.clone();
      materialCloneMap.set(mat, cloned);
    }
    return cloned;
  };

  scene.traverse((node: any) => {
    if (node.isBone) {
      clonedBones.set(node.name, node as THREE.Bone);
    }
    if (node.isSkinnedMesh) {
      clonedSkinned.push(node as THREE.SkinnedMesh);
    } else if (node.isMesh && node.material) {
      node.material = cloneMaterialShared(node.material);
    }
  });

  const skeletonMap = new Map<THREE.Skeleton, THREE.Skeleton>();
  for (const node of clonedSkinned) {
    const originalMesh = skinnedMeshes[node.name];
    if (!originalMesh || !originalMesh.skeleton) continue;

    const srcSkeleton = originalMesh.skeleton;
    let skeleton = skeletonMap.get(srcSkeleton);
    if (!skeleton) {
      const bones = srcSkeleton.bones.map((bone: THREE.Bone) => clonedBones.get(bone.name) ?? bone);
      const boneInverses = srcSkeleton.boneInverses.map((matrix: THREE.Matrix4) => matrix.clone());
      skeleton = new RootRelativeSkeleton(bones, boneInverses, scene);
      skeletonMap.set(srcSkeleton, skeleton);
    }
    node.bind(skeleton, node.bindMatrix);

    if (originalMesh.material) {
      node.material = cloneMaterialShared(originalMesh.material as THREE.Material);
    }
  }

  const skinnedResult = mergeSkinnedSiblings(clonedSkinned);

  // The clone is detached, so after one world pass meshWorld⁻¹ · sceneWorld is
  // exactly the constant root-relative bind inverse (see RootRelativeSkeleton).
  scene.updateMatrixWorld(true);
  for (const node of skinnedResult) {
    node.bindMatrixInverse.copy(node.matrixWorld).invert().multiply(scene.matrixWorld);
    node.updateMatrixWorld = updateMatrixWorldKeepBind;
    node.applyBoneTransform = applyBoneTransformRootRelative;
  }

  return { scene, animations, skinnedMeshes: skinnedResult };
}

const createClone = (key: string, gltf: any, quantization: number | undefined): PooledModelClone => {
  const { scene, animations, skinnedMeshes } = cloneModelWithAnimations(gltf);

  const materialSet = new Set<THREE.Material>();
  const skeletonSet = new Set<THREE.Skeleton>();
  scene.traverse((child: THREE.Object3D) => {
    if ((child as any).isSkinnedMesh && (child as THREE.SkinnedMesh).skeleton) {
      skeletonSet.add((child as THREE.SkinnedMesh).skeleton);
    }
    if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        materials.forEach((mat) => {
          if (materialSet.has(mat)) return;
          materialSet.add(mat);
          // Opaque for good: the spawn fade is a screen-door dither (vfx/spawn-fade/index.ts), not alpha.
          mat.transparent = false;
          mat.opacity = 1;
          (mat as any).fog = false;

          prepareActorMaterial(mat, {
            quantization,
            skipQuantization: child.userData?.skipQuantization,
          });
        });

        // A skinned part's bounds are its REST pose's (frozen below): a head turned or fallen away from them
        // lost its eyes, nose or ears up close. The actor base culls the whole actor (useActorLifecycle).
        mesh.frustumCulled = !(mesh as THREE.SkinnedMesh).isSkinnedMesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Deferring program link + uploads to the first LOOK was a 50-90ms render spike.
        uploadOnFirstDraw(mesh);
      }
    }
  });

  const bbox = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // three computes skinned bounds LAZILY at the first frustum test — out at
  // the spawn coordinates — and caches them for the clone's whole pooled life.
  // Freeze them here, in rest pose at the origin.
  for (const node of skinnedMeshes) {
    if (node.boundingBox === null) node.computeBoundingBox();
    if (node.boundingSphere === null) node.boundingSphere = new THREE.Sphere();
    const box = node.boundingBox!;
    box.getBoundingSphere(node.boundingSphere);
    const pad = node.boundingSphere.radius * (SKINNED_BOUNDS_PAD - 1);
    box.expandByScalar(pad);
    node.boundingSphere.radius += pad;
  }

  return {
    key,
    scene,
    animations,
    materials: Array.from(materialSet),
    skeletons: Array.from(skeletonSet),
    mixer: animations.length > 0 ? new THREE.AnimationMixer(scene) : null,
    actions: new Map(),
    baseRadius: Math.max(size.x, size.y, size.z) / 2,
    releaseTimer: null,
  };
};

const disposeClone = (clone: PooledModelClone): void => {
  for (const mat of clone.materials) mat.dispose();
  for (const skeleton of clone.skeletons) skeleton.dispose();
  clone.actions.clear();
};

const poolKey = (model: string, quantization: number | undefined): string =>
  `${model}|${quantization ?? "global"}`;

/** Cheap enough to call synchronously in render; null on a pool miss. */
export const acquirePooledModelClone = (model: string, quantization: number | undefined): PooledModelClone | null => {
  return pools.get(poolKey(model, quantization))?.pop() ?? null;
};

/** Heavy on a miss (deep clone + patches + rebind): run from a task queue, never in render. */
export const acquireModelClone = (
  model: string,
  gltf: any,
  quantization: number | undefined
): PooledModelClone =>
  acquirePooledModelClone(model, quantization) ?? createClone(poolKey(model, quantization), gltf, quantization);

/** Cancels a pending release so a StrictMode remount keeps its clone. */
export const markPoseChanged = (clone: PooledModelClone): void => {
  for (const skeleton of clone.skeletons) if (skeleton instanceof RootRelativeSkeleton) skeleton.poseChanged = true;
};

export const reclaimModelClone = (clone: PooledModelClone): void => {
  if (clone.releaseTimer !== null) {
    clearTimeout(clone.releaseTimer);
    clone.releaseTimer = null;
  }
};

/** Deferred one macrotask: React 18 StrictMode re-runs cleanup + setup
 *  synchronously, and an immediate release let another component adopt a
 *  scene still mounted in this one's tree. */
export const releaseModelClone = (clone: PooledModelClone): void => {
  if (clone.releaseTimer !== null) return;
  clone.releaseTimer = setTimeout(() => {
    clone.releaseTimer = null;
    clone.mixer?.stopAllAction();
    stripAttachments(clone.scene);
    let pool = pools.get(clone.key);
    if (!pool) {
      pool = [];
      pools.set(clone.key, pool);
    }
    if (pool.length < MAX_POOLED_PER_KEY) {
      pool.push(clone);
    } else {
      disposeClone(clone);
    }
  }, 0);
};
