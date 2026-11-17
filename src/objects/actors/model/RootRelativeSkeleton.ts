import * as THREE from "three";

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

export class RootRelativeSkeleton extends THREE.Skeleton {
  private readonly root: THREE.Object3D;
  /** Identity until the first update(), correct while the detached clone sits at the origin. */
  readonly rootInverse = new THREE.Matrix4();
  /** Bone matrices are root-relative, so they change only with the POSE, never as the actor moves: while
   *  it holds (a stepped clip between frames), update() skips the bone loop and the bone-texture upload.
   *  Whoever re-poses the bones sets it (markPoseChanged). */
  poseChanged = true;

  constructor(bones: THREE.Bone[], boneInverses: THREE.Matrix4[], root: THREE.Object3D) {
    super(bones, boneInverses);
    this.root = root;
  }

  update(): void {
    const bones = this.bones;
    const boneInverses = this.boneInverses;
    const boneMatrices = this.boneMatrices;

    // Refreshed every frame: applyBoneTransformRootRelative (bounds, raycasts) pairs it with the live bone.matrixWorld.
    this.rootInverse.copy(this.root.matrixWorld).invert();
    if (!this.poseChanged) return;
    this.poseChanged = false;

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
export function applyBoneTransformRootRelative(
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
export function updateMatrixWorldKeepBind(this: THREE.SkinnedMesh, force?: boolean): void {
  THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
}
