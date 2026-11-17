/**
 * THE hinged door, shared by the buildings and the sewers: the leaf's geometry, the swing and the
 * hover pick. A door is a hinge group at the opening's hinge edge whose leaf runs along +x; swinging
 * turns the hinge about y toward +z.
 */
import * as THREE from "three";
import { DOOR_SWING_RATE, DOOR_OPEN_ANGLE } from "./constants";

/** Eases every hinge toward its open or closed angle; recomposes the hinge's matrices (frozen
 *  subtrees) and reports each angle that moved. Returns whether any still moves. */
export const swingDoors = (hinges: readonly (THREE.Object3D | null)[], open: readonly boolean[], delta: number, onAngle?: (index: number, angle: number) => void): boolean => {
  let stillMoving = false;
  const ease = 1 - Math.exp(-DOOR_SWING_RATE * delta);
  for (let i = 0; i < hinges.length; i++) {
    const hinge = hinges[i];
    if (!hinge) continue;
    const target = open[i] ? DOOR_OPEN_ANGLE : 0;
    const diff = target - hinge.rotation.y;
    if (Math.abs(diff) < 1e-3) {
      if (diff === 0) continue;
      hinge.rotation.y = target;
    } else {
      hinge.rotation.y += diff * ease;
      stillMoving = true;
    }
    hinge.updateMatrix();
    hinge.updateMatrixWorld(true);
    onAngle?.(i, hinge.rotation.y);
  }
  return stillMoving;
};

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _sphere = new THREE.Sphere();
const _hits: THREE.Intersection[] = [];

/** The nearest visible leaf hit by the screen-center ray within `reach`, or −1. */
export const hoveredDoor = (camera: THREE.Camera, leaves: readonly (THREE.Mesh | null)[], reach: number, hit?: { distance: number }): number => {
  let hover = -1;
  let nearest = Infinity;
  _raycaster.setFromCamera(_center, camera);
  _raycaster.far = reach;
  for (let i = 0; i < leaves.length; i++) {
    const mesh = leaves[i];
    if (!mesh || !mesh.visible) continue;
    const geo = mesh.geometry;
    if (geo.boundingSphere === null) geo.computeBoundingSphere();
    _sphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    if (!_raycaster.ray.intersectsSphere(_sphere)) continue;
    _hits.length = 0;
    _raycaster.intersectObject(mesh, false, _hits);
    if (_hits.length > 0 && _hits[0].distance < nearest) {
      nearest = _hits[0].distance;
      hover = i;
    }
  }
  _raycaster.far = Infinity;
  if (hit) hit.distance = nearest;
  return hover;
};
