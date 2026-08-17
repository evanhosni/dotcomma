import * as THREE from "three";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { prepareActorMaterial } from "./Actor";

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
/** Slack on the rest-pose bounds of skinned meshes, so an animated pose
 *  reaching past the bind pose isn't culled. Conservative is free here —
 *  GameObject does its own (tighter) distance/frustum test on top. */
const SKINNED_BOUNDS_PAD = 1.5;

// ── Root-relative skinning (float32 far-from-origin fix) ───────────────────
// three's stock Skeleton.update writes bone.matrixWorld × boneInverse — an
// ABSOLUTE world matrix — into the float32 bone texture, and the shader
// cancels those huge translations against bindMatrixInverse (≈ inverse mesh
// world, also huge) PER VERTEX in float32. Far from the world origin the
// cancellation loses precision and skinned actors (beebles) visibly jitter,
// growing with distance — the same failure class the coordinate-precision
// rules cover for static geometry (see CLAUDE.md).
//
// Fix: store ROOT-RELATIVE bone matrices (rootWorld⁻¹ × boneWorld ×
// boneInverse — the huge translations cancel on the CPU in float64), and
// freeze each skinned mesh's bindMatrixInverse at its CONSTANT root-relative
// value (mesh nodes never move relative to their model root; only bones
// animate). Mathematically identical — meshWorld⁻¹·boneWorld ≡
// meshRel⁻¹·(rootWorld⁻¹·boneWorld) — but every float32-stored intermediate
// (bone texture, bind uniforms) stays model-sized. Covers the GPU skinning
// path AND the CPU one (applyBoneTransform — raycasts, skinned bounds).

const _boneOffset = new THREE.Matrix4();
const _identityMatrix = new THREE.Matrix4();
const _skinIndex = new THREE.Vector4();
const _skinWeight = new THREE.Vector4();
const _basePosition = new THREE.Vector3();
const _skinnedVertex = new THREE.Vector3();

class RootRelativeSkeleton extends THREE.Skeleton {
  private readonly root: THREE.Object3D;
  /** root.matrixWorld⁻¹ as of the last update() — identity until then, which
   *  is correct while the fresh clone is still detached at the origin. Shared
   *  with applyBoneTransformRootRelative so the CPU path doesn't invert a
   *  matrix per vertex. */
  readonly rootInverse = new THREE.Matrix4();

  constructor(bones: THREE.Bone[], boneInverses: THREE.Matrix4[], root: THREE.Object3D) {
    super(bones, boneInverses);
    this.root = root;
  }

  update(): void {
    const bones = this.bones;
    const boneInverses = this.boneInverses;
    const boneMatrices = this.boneMatrices;

    // The renderer calls update() after the scene graph's matrixWorld pass,
    // so root.matrixWorld is current. Inverting here is float64 (JS numbers);
    // one extra 4×4 multiply per bone is noise next to the skinning itself.
    this.rootInverse.copy(this.root.matrixWorld).invert();

    for (let i = 0, il = bones.length; i < il; i++) {
      const matrix = bones[i] ? bones[i].matrixWorld : _identityMatrix;
      _boneOffset.multiplyMatrices(this.rootInverse, matrix).multiply(boneInverses[i]);
      _boneOffset.toArray(boneMatrices, i * 16);
    }

    if (this.boneTexture !== null) {
      this.boneTexture.needsUpdate = true;
    }
  }
}

/** three's stock applyBoneTransform pairs the ABSOLUTE bone.matrixWorld with
 *  bindMatrixInverse (normally ≈ meshWorld⁻¹, so the two cancel into mesh-LOCAL
 *  space). Ours is frozen at the root-relative value, so the stock version
 *  returns near-WORLD-space points — and every caller (computeBoundingSphere /
 *  computeBoundingBox / raycast) then applies matrixWorld on top, DOUBLING the
 *  object's world position: the culling sphere ends up thousands of units away
 *  from the mesh, and skinned actors vanish the moment the sphere's constant
 *  offset subtends more than the FOV (i.e. as the player gets CLOSE). Inserting
 *  the root inverse restores the cancellation the frozen bind expects. */
function applyBoneTransformRootRelative(
  this: THREE.SkinnedMesh,
  index: number,
  vector: THREE.Vector3
): THREE.Vector3 {
  const skeleton = this.skeleton as RootRelativeSkeleton;
  const geometry = this.geometry;

  _skinIndex.fromBufferAttribute(geometry.attributes.skinIndex as THREE.BufferAttribute, index);
  _skinWeight.fromBufferAttribute(geometry.attributes.skinWeight as THREE.BufferAttribute, index);

  _basePosition.copy(vector).applyMatrix4(this.bindMatrix);
  vector.set(0, 0, 0);

  for (let i = 0; i < 4; i++) {
    const weight = _skinWeight.getComponent(i);
    if (weight === 0) continue;
    const boneIndex = _skinIndex.getComponent(i);
    _boneOffset
      .multiplyMatrices(skeleton.rootInverse, skeleton.bones[boneIndex].matrixWorld)
      .multiply(skeleton.boneInverses[boneIndex]);
    vector.addScaledVector(_skinnedVertex.copy(_basePosition).applyMatrix4(_boneOffset), weight);
  }

  return vector.applyMatrix4(this.bindMatrixInverse);
}

/** Object3D's updateMatrixWorld WITHOUT SkinnedMesh's attached-mode sync
 *  (which would overwrite bindMatrixInverse with the huge inverse world
 *  matrix every frame) — ours is frozen at its constant root-relative value,
 *  the pairing partner of RootRelativeSkeleton's bone matrices. */
function updateMatrixWorldKeepBind(this: THREE.SkinnedMesh, force?: boolean): void {
  THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
}

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

  // Freeze each skinned mesh's bindMatrixInverse at its ROOT-RELATIVE value
  // (see RootRelativeSkeleton). The clone is detached here, so one world pass
  // makes matrixWorld the root-chain transform; meshWorld⁻¹ · sceneWorld is
  // then exactly the mesh-relative-to-root inverse, constant for the clone's
  // lifetime — the attached-mode per-frame sync is disabled by the override.
  scene.updateMatrixWorld(true);
  for (const node of clonedSkinned) {
    node.bindMatrixInverse.copy(node.matrixWorld).invert().multiply(scene.matrixWorld);
    node.updateMatrixWorld = updateMatrixWorldKeepBind;
    node.applyBoneTransform = applyBoneTransformRootRelative;
  }

  return { scene, animations, skinnedMeshes: clonedSkinned };
}

/** Fresh clone, fully prepared: materials patched (quantization + lamp glow),
 *  fade state initialized, GPU warm draw queued, mixer created, bounds
 *  measured. Runs ONCE per pooled record — reuses skip all of it. */
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
          mat.transparent = true;
          mat.opacity = 0;
          (mat as any).fog = false;

          // ALL shared actor material logic in one call — quantization, lamp
          // glow, world curvature (see actors/Actor.tsx). A new world-wide
          // effect is added there, never here.
          prepareActorMaterial(mat, {
            quantization,
            skipQuantization: child.userData?.skipQuantization,
          });
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
  // here, so this is the model's own extent — instances scale it). This also
  // populates each skinned mesh's cached local boundingBox, since Box3
  // computes and keeps one per mesh.
  const bbox = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // FREEZE the skinned meshes' own culling/raycast bounds here, in rest pose
  // while the clone still sits at the origin. three otherwise computes them
  // LAZILY at the first frustum test — i.e. once the actor is already out at
  // its spawn coordinates — and caches the result for the clone's whole life
  // (pool reuse included), so a stale, world-sized sphere would keep culling
  // the mesh at the wrong place. Padded because the rest pose is not the
  // widest pose an animation reaches.
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
