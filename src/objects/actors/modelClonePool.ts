import * as THREE from "three";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { prepareActorMaterial } from "./Actor";

// Pool of prepared GLTF clones keyed by (model | quantization override).
// Pools survive domain switches (clones are domain-agnostic); the override is
// part of the key because it is BAKED into the materials, while no-override
// materials follow the live global uniform. Geometry is shared with the
// source GLTF and never disposed here.

// Past ActorPool's MAX_MOUNTS_PER_BATCH (20), so a despawn+respawn wave of one model finds every clone parked.
const MAX_POOLED_PER_KEY = 24;
/** Rest-pose bounds slack so an animated pose isn't culled. */
const SKINNED_BOUNDS_PAD = 1.5;

// Root-relative skinning (see CLAUDE.md → Coordinate Precision, "Skinned
// actors"): stock skinning cancels ABSOLUTE bone matrices against
// bindMatrixInverse per vertex in float32, so beebles jitter far from the
// origin. Bone matrices are stored root-relative (cancelled in float64 here)
// and each mesh's bindMatrixInverse is frozen at its constant root-relative
// value. Both the GPU path and the CPU path (applyBoneTransform) must agree.

const _boneOffset = new THREE.Matrix4();
const _identityMatrix = new THREE.Matrix4();
const _skinIndex = new THREE.Vector4();
const _skinWeight = new THREE.Vector4();
const _basePosition = new THREE.Vector3();
const _skinnedVertex = new THREE.Vector3();

class RootRelativeSkeleton extends THREE.Skeleton {
  private readonly root: THREE.Object3D;
  /** Identity until the first update(), correct while the detached clone sits at the origin. */
  readonly rootInverse = new THREE.Matrix4();

  constructor(bones: THREE.Bone[], boneInverses: THREE.Matrix4[], root: THREE.Object3D) {
    super(bones, boneInverses);
    this.root = root;
  }

  update(): void {
    const bones = this.bones;
    const boneInverses = this.boneInverses;
    const boneMatrices = this.boneMatrices;

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

/** Stock applyBoneTransform reads the ABSOLUTE bone.matrixWorld, so with the
 *  frozen bind it returned near-world-space points that callers (bounds,
 *  raycast) re-multiplied by matrixWorld — a culling sphere at twice the
 *  actor's position, and beebles vanished as the player approached. */
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

/** SkinnedMesh's attached-mode sync would overwrite the frozen bindMatrixInverse every frame. */
function updateMatrixWorldKeepBind(this: THREE.SkinnedMesh, force?: boolean): void {
  THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
}

export interface PooledModelClone {
  key: string;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  materials: THREE.Material[];
  skeletons: THREE.Skeleton[];
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  /** Unscaled bind-pose bounding radius; per-instance radius = this × max(scale). */
  baseRadius: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const pools = new Map<string, PooledModelClone[]>();

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

  // The clone is detached, so after one world pass meshWorld⁻¹ · sceneWorld is
  // exactly the constant root-relative bind inverse (see RootRelativeSkeleton).
  scene.updateMatrixWorld(true);
  for (const node of clonedSkinned) {
    node.bindMatrixInverse.copy(node.matrixWorld).invert().multiply(scene.matrixWorld);
    node.updateMatrixWorld = updateMatrixWorldKeepBind;
    node.applyBoneTransform = applyBoneTransformRootRelative;
  }

  return { scene, animations, skinnedMeshes: clonedSkinned };
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
          mat.transparent = true;
          mat.opacity = 0;
          (mat as any).fog = false;

          prepareActorMaterial(mat, {
            quantization,
            skipQuantization: child.userData?.skipQuantization,
          });
        });

        mesh.frustumCulled = true;
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
  const clone = pools.get(poolKey(model, quantization))?.pop();
  if (!clone) return null;
  for (const mat of clone.materials) {
    mat.opacity = 0;
    mat.transparent = true;
  }
  return clone;
};

/** Heavy on a miss (deep clone + patches + rebind): run from a task queue, never in render. */
export const acquireModelClone = (
  model: string,
  gltf: any,
  quantization: number | undefined
): PooledModelClone =>
  acquirePooledModelClone(model, quantization) ?? createClone(poolKey(model, quantization), gltf, quantization);

/** Cancels a pending release so a StrictMode remount keeps its clone. */
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
