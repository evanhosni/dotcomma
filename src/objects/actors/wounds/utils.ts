import * as THREE from "three";

/** A point on a skinned surface: moved by `bones` (with their bind inverses) by `weights`, as the vertex under
 *  it is (a wound's hole, a stump's middle). */
export interface SkinnedPoint {
  bones: THREE.Bone[];
  inverses: THREE.Matrix4[];
  weights: number[];
  /** Where it is in the bind space. */
  bind: THREE.Vector3;
  /** The skin's outward normal there, in the bind space. */
  normal: THREE.Vector3;
}

const _blend = new THREE.Matrix4();
const _part = new THREE.Matrix4();

/** Its skinning now: Σ weight · bone · bind⁻¹, as the surface around it is skinned (the root-relative
 *  skinning, model/RootRelativeSkeleton.ts, draws the same world points). */
export const skinBlendOf = (point: SkinnedPoint): THREE.Matrix4 => {
  _blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (let i = 0; i < point.bones.length; i++) {
    _part.multiplyMatrices(point.bones[i].matrixWorld, point.inverses[i]);
    for (let e = 0; e < 16; e++) _blend.elements[e] += _part.elements[e] * point.weights[i];
  }
  return _blend;
};

/** Where it is now. */
export const skinnedPointWorld = (point: SkinnedPoint, out: THREE.Vector3): THREE.Vector3 => out.copy(point.bind).applyMatrix4(skinBlendOf(point));

/** Where it is now, and which way its skin faces there. */
export const skinnedFrameOf = (point: SkinnedPoint, at: THREE.Vector3, normal: THREE.Vector3): void => {
  const blend = skinBlendOf(point);
  at.copy(point.bind).applyMatrix4(blend);
  normal.copy(point.normal).transformDirection(blend);
};
