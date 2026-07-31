import * as THREE from "three";
import { CLIP_BIAS, NEAR_CLIP_LIMIT } from "./constants";

/**
 * Portal-pair transform math, shared by the teleport system and the renderer.
 *
 * Both use the same rigid transform: a point (or camera) expressed relative to
 * the source portal is re-expressed relative to the paired portal, with a 180°
 * yaw flip so that "walking into" the source comes out "walking out of" the
 * destination. This is the technique Valve's Portal uses — because the exact
 * same matrix drives the portal preview render and the teleport, the frame
 * before and after crossing are pixel-identical.
 */

const _flip = new THREE.Matrix4().makeRotationY(Math.PI);
const _flipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _relQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();

/** out = destMatrix * rotY(180°) * srcInvMatrix. Apply to any world-space
 *  point/matrix to carry it through the portal pair. */
export const getPortalPairMatrix = (
  srcInvMatrix: THREE.Matrix4,
  destMatrix: THREE.Matrix4,
  out: THREE.Matrix4,
): THREE.Matrix4 => {
  return out.copy(destMatrix).multiply(_flip).multiply(srcInvMatrix);
};

/** Yaw (radians) the camera must rotate by when carried through the pair.
 *  Portals are upright (yaw-only), so a single yaw delta fully describes the
 *  orientation change — applying it as a quaternion premultiply avoids Euler
 *  gimbal flips at non-zero pitch. */
export const getPortalPairYaw = (srcQuat: THREE.Quaternion, destQuat: THREE.Quaternion): number => {
  _relQuat.copy(srcQuat).invert().premultiply(_flipQuat).premultiply(destQuat);
  _euler.setFromQuaternion(_relQuat, "YXZ");
  return _euler.y;
};

/** Distance from the camera to the corner of its near plane — the radius the
 *  portal surface must be extruded by so the near plane can never clip a hole
 *  through it while the player steps across. */
export const getNearPlaneCornerDistance = (camera: THREE.PerspectiveCamera): number => {
  const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.near;
  const halfH = halfV * camera.aspect;
  return Math.sqrt(camera.near * camera.near + halfV * halfV + halfH * halfH);
};

// --- Oblique near-plane clipping (Lengyel method) scratch ---
const _clipNormal = new THREE.Vector3();
const _clipPoint = new THREE.Vector3();
const _clipNormalCam = new THREE.Vector3();
const _clipPointCam = new THREE.Vector3();
const _clipVec4 = new THREE.Vector4();
const _oblQ = new THREE.Vector4();
const _mat3 = new THREE.Matrix3();
const _toPlane = new THREE.Vector3();

/**
 * Bend `camera`'s projection so its near plane coincides with the portal
 * plane (Lengyel oblique clipping) — geometry behind the destination portal
 * is clipped out of the preview. Requires camera.position,
 * matrixWorldInverse, and projectionMatrix to be current; updates
 * projectionMatrix and projectionMatrixInverse in place.
 *
 * The plane normal must point AWAY from the camera; portal normals may face
 * either way, so it's oriented explicitly. The plane is also kept at least
 * NEAR_CLIP_LIMIT from the camera — a near-degenerate oblique projection
 * destroys depth precision (flicker right at the crossing moment). Clamping
 * instead of disabling keeps the source-side shell geometry around the
 * camera clipped away; the cost is that up to a NEAR_CLIP_LIMIT sliver of
 * scene just beyond the plane is clipped too, hidden by the doorway filling
 * the screen.
 */
export const applyObliqueNearClip = (
  camera: THREE.PerspectiveCamera,
  planePosition: THREE.Vector3,
  planeQuaternion: THREE.Quaternion,
): void => {
  _clipNormal.set(0, 0, 1).applyQuaternion(planeQuaternion);
  if (_clipNormal.dot(_toPlane.copy(planePosition).sub(camera.position)) < 0) {
    _clipNormal.negate();
  }
  _clipPoint.copy(planePosition).addScaledVector(_clipNormal, CLIP_BIAS);

  // Transform the clip plane into camera space
  _mat3.setFromMatrix4(camera.matrixWorldInverse);
  _clipNormalCam.copy(_clipNormal).applyMatrix3(_mat3).normalize();
  _clipPointCam.copy(_clipPoint).applyMatrix4(camera.matrixWorldInverse);
  const d = -_clipNormalCam.dot(_clipPointCam);
  _clipVec4.set(_clipNormalCam.x, _clipNormalCam.y, _clipNormalCam.z, Math.min(d, -NEAR_CLIP_LIMIT));

  const p = camera.projectionMatrix.elements;
  _oblQ.x = (Math.sign(_clipVec4.x) + p[8]) / p[0];
  _oblQ.y = (Math.sign(_clipVec4.y) + p[9]) / p[5];
  _oblQ.z = -1.0;
  _oblQ.w = (1.0 + p[10]) / p[14];

  const scale = 2.0 / _clipVec4.dot(_oblQ);
  p[2] = _clipVec4.x * scale;
  p[6] = _clipVec4.y * scale;
  p[10] = _clipVec4.z * scale + 1.0;
  p[14] = _clipVec4.w * scale;

  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
};
