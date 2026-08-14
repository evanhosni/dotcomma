import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../lighting/lampGlow";
import { _quantization } from "../utils/quantization/quantization";
import { uploadOnFirstDraw } from "../utils/uploadOnFirstDraw";

/**
 * Pool of prepared GLTF model clones, keyed by (model url | quantization
 * override). Used by <GameObject>.
 *
 * Spawn churn (despawn behind the player, respawn ahead) used to re-run the
 * full clone pipeline on EVERY mount: scene clone, traversals, material
 * clones + shader patches (quantization, lamp glow), skeleton rebind,
 * bounding-box measure — and the matching unmount disposed it all again. A
 * released clone is instead parked here and handed back fully prepared, so a
 * respawn costs a map lookup + a material opacity reset.
 *
 * Safety properties:
 *  - Clones are domain-agnostic (keyed by GLTF url), so pools deliberately
 *    survive domain switches — same policy as the geometry/texture/building
 *    caches (see world/domains/reset.ts). Materials WITHOUT a quantization
 *    override share the live global uniform (utils/quantization), so a domain
 *    changing the global grid is picked up automatically; overrides are baked
 *    per material, which is why the override value is part of the pool key.
 *  - Release is DEFERRED one macrotask and cancellable (reclaimModelClone):
 *    React 18 StrictMode re-runs effects (cleanup + setup) synchronously in
 *    dev, and an immediate release would let another component adopt a scene
 *    object still mounted in this component's tree.
 *  - The pool is bounded per key; overflow disposes exactly what the old
 *    per-mount teardown disposed — the material clones and each shared cloned
 *    skeleton's bone texture. Geometry is SHARED with the source GLTF scene
 *    and is never disposed here.
 */

const MAX_POOLED_PER_KEY = 8;

export interface PooledModelClone {
  key: string;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Deduped material clones (fade targets) — patched once at creation. */
  materials: THREE.Material[];
  /** Deduped cloned skeletons (bone textures disposed on pool eviction). */
  skeletons: THREE.Skeleton[];
  mixer: THREE.AnimationMixer | null;
  /** Lazily bound actions (see GameObject's getOrCreateAction). */
  actions: Map<string, THREE.AnimationAction>;
  /** Unscaled bounding radius (max bbox dimension / 2), measured once in
   *  bind pose at creation. Per-instance sphere radius = this × max(scale). */
  baseRadius: number;
  /** Pending deferred release, cancellable by reclaimModelClone. */
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const pools = new Map<string, PooledModelClone[]>();

/** Clone a GLTF scene with correctly rebound skeletons.
 *
 * Single pass over the clone: bones indexed by name (the old per-bone
 * re-traversal was O(bones × scene nodes) and caused spawn-batch hitches).
 * Material clones are deduped by SOURCE material: a model like beeble.glb has
 * 10 meshes sharing a handful of materials, and cloning per MESH meant that
 * many extra materials to patch, fade-drive, and dispose per instance.
 * Skeletons are deduped by SOURCE skeleton, mirroring SkeletonUtils.clone:
 * beeble.glb has 10 skinned meshes all bound to ONE 24-joint skeleton, and a
 * per-mesh skeleton.clone() created 10 skeletons → 10× Skeleton.update() +
 * 10 bone-texture uploads per instance per frame. One clone per source
 * skeleton (bones rebound to the cloned bone instances by name), bound to
 * each mesh with its own bindMatrix.
 */
function cloneModelWithAnimations(gltf: any): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
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
      skeleton = new THREE.Skeleton(bones, boneInverses);
      skeletonMap.set(srcSkeleton, skeleton);
    }
    node.bind(skeleton, node.bindMatrix);

    if (originalMesh.material) {
      node.material = cloneMaterialShared(originalMesh.material as THREE.Material);
    }
  }

  return { scene, animations };
}

/** Fresh clone, fully prepared: materials patched (quantization + lamp glow),
 *  fade state initialized, GPU warm draw queued, mixer created, bounds
 *  measured. Runs ONCE per pooled record — reuses skip all of it. */
const createClone = (key: string, gltf: any, quantization: number | undefined): PooledModelClone => {
  const { scene, animations } = cloneModelWithAnimations(gltf);

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
          mat.transparent = true;
          mat.opacity = 0;
          (mat as any).fog = false;

          if (!child.userData?.skipQuantization) {
            _quantization.patchMaterial(mat, quantization);
          }
          // Street-lamp glow — NPCs/objects near a lamp brighten like the
          // terrain and buildings do (grid lookup, no real lights)
          patchStandardMaterialLampGlow(mat);
        });

        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Warm the GPU at creation: force one real draw so this model type's
        // shader programs link and its textures/buffers upload NOW (creation
        // is staggered by spawn batches) instead of inside gl.render the
        // frame the player first LOOKS at one — measured as 50-90ms
        // render-internal spikes. GameObject's warm frames keep the group
        // visible long enough for that draw to actually happen.
        uploadOnFirstDraw(mesh);
      }
    }
  });

  // Bind-pose bounds, measured once (the scene is detached and untransformed
  // here, so this is the model's own extent — instances scale it).
  const bbox = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  bbox.getSize(size);

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

/** Per-instance GPU resources — only ever run on pool-overflow eviction. */
const disposeClone = (clone: PooledModelClone): void => {
  for (const mat of clone.materials) mat.dispose();
  for (const skeleton of clone.skeletons) skeleton.dispose();
  clone.actions.clear();
};

const poolKey = (model: string, quantization: number | undefined): string =>
  `${model}|${quantization ?? "global"}`;

/** Get a prepared clone — pooled if one is parked, freshly created otherwise.
 *  Reused clones come back with their fade state reset (opacity 0). */
export const acquireModelClone = (
  model: string,
  gltf: any,
  quantization: number | undefined
): PooledModelClone => {
  const clone = pools.get(poolKey(model, quantization))?.pop();
  if (clone) {
    // Reset shared state for the new life: the object fades in from zero.
    for (const mat of clone.materials) {
      mat.opacity = 0;
      mat.transparent = true;
    }
    return clone;
  }
  return createClone(poolKey(model, quantization), gltf, quantization);
};

/** Cancel a pending deferred release — called from the owning component's
 *  effect setup so a StrictMode remount keeps its clone. No-op when nothing
 *  is pending. */
export const reclaimModelClone = (clone: PooledModelClone): void => {
  if (clone.releaseTimer !== null) {
    clearTimeout(clone.releaseTimer);
    clone.releaseTimer = null;
  }
};

/** Return a clone to the pool (deferred one macrotask — see module doc). */
export const releaseModelClone = (clone: PooledModelClone): void => {
  if (clone.releaseTimer !== null) return;
  clone.releaseTimer = setTimeout(() => {
    clone.releaseTimer = null;
    clone.mixer?.stopAllAction();
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
