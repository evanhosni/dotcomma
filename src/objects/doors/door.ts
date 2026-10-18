import * as THREE from "three";
import { QUANTIZATION_GRID } from "../../world/constants";
import { bakeVertexColor, mergeOrThrow } from "../geometry";
import type { DoorHandle, DoorLeafBox } from "./types";

/**
 * THE hinged door, shared by the buildings and the sewers: the leaf's geometry, the swing and the
 * hover pick. A door is a hinge group at the opening's hinge edge whose leaf runs along +x; swinging
 * turns the hinge about y toward +z.
 */

/** Rad, toward +z. */
export const DOOR_OPEN_ANGLE = -1.9;
/** 1/s, exponential ease. */
const DOOR_SWING_RATE = 4;

/** The leaf overlaps the jamb and header so a closed door never shows a gap. */
const LEAF_OVERLAP_WIDTH = 0.16;
const LEAF_OVERLAP_HEIGHT = 0.2;
export const LEAF_THICKNESS = 0.1;
const LEAF_LIFT = 0.05;
/** The handle: a spindle through the leaf this far in from the free edge, at a third of the height. */
const HANDLE_INSET = 0.4;
const HANDLE_HEIGHT_SHARE = 0.33;
const HANDLE_STANDOFF = 0.16;
const KNOB_RADIUS = 0.11;
const LEVER_SIZE: [number, number, number] = [0.42, 0.07, 0.08];
const LEVER_SETBACK = 0.17;
const SPINDLE_RADIUS = 0.04;

/** How a leaf meets its opening: OVERLAPPING the jambs and header on its face (a closed door shows no
 *  gap; the buildings'), or INSIDE the opening with LEAF_CLEARANCE all round (the sewers': the frame is
 *  the opening's own jambs, so the leaf must fit between them). */
export type DoorFit = "overlap" | "inside";
/** ONE quantization step: the leaf's edge and the jamb (its top and the lintel) snap to lattice points
 *  exactly a step apart, so the closed door shows a fixed 2.5cm crack. Less, and they can snap onto each
 *  other; more (0.04 before), and the crack is one or two steps by the lattice's phase, 5cm at most. */
const LEAF_CLEARANCE = QUANTIZATION_GRID;

/** A leaf for an opening `width` × `height` in `color`, with its handle on both faces: vertex-colored,
 *  uv dropped, origin at the hinge edge. Returns the leaf's box too, for far stand-ins. */
export const makeDoorGeometry = (width: number, height: number, color: number, handle: DoorHandle, fit: DoorFit = "overlap"): { geometry: THREE.BufferGeometry; leaf: DoorLeafBox } => {
  const leafW = fit === "overlap" ? width + LEAF_OVERLAP_WIDTH : width - 2 * LEAF_CLEARANCE;
  const leafH = fit === "overlap" ? height + LEAF_OVERLAP_HEIGHT : height - LEAF_CLEARANCE - LEAF_LIFT;
  // The mesh is mounted at height / 2: the overlap leaf is centred LEAF_LIFT above that; the inside leaf
  // is centred so it spans LEAF_LIFT over the floor to LEAF_CLEARANCE under the lintel.
  const leaf: DoorLeafBox = { center: [fit === "overlap" ? leafW / 2 - LEAF_OVERLAP_WIDTH / 2 : leafW / 2 + LEAF_CLEARANCE, fit === "overlap" ? LEAF_LIFT : (LEAF_LIFT - LEAF_CLEARANCE) / 2, 0], size: [leafW, leafH, LEAF_THICKNESS], color };
  const x = leaf.center[0] + leaf.size[0] / 2 - HANDLE_INSET;
  const y = -height / 2 + height * HANDLE_HEIGHT_SHARE;
  const face = leaf.size[2] / 2;
  const parts: THREE.BufferGeometry[] = [
    bakeVertexColor(new THREE.BoxGeometry(...leaf.size).translate(...leaf.center).toNonIndexed(), color),
    bakeVertexColor(new THREE.CylinderGeometry(SPINDLE_RADIUS, SPINDLE_RADIUS, leaf.size[2] + 2 * (HANDLE_STANDOFF + 0.02), 8).rotateX(Math.PI / 2).translate(x, y, 0).toNonIndexed(), handle.color),
  ];
  for (const side of [1, -1]) {
    const z = side * (face + HANDLE_STANDOFF);
    parts.push(
      bakeVertexColor(
        handle.lever ? new THREE.BoxGeometry(...LEVER_SIZE).translate(x - LEVER_SETBACK, y, z).toNonIndexed() : new THREE.SphereGeometry(KNOB_RADIUS, 10, 8).translate(x, y, z).toNonIndexed(),
        handle.color,
      ),
    );
  }
  const geometry = mergeOrThrow(parts, "door leaf");
  geometry.deleteAttribute("uv");
  return { geometry, leaf };
};

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
export const hoveredDoor = (camera: THREE.Camera, leaves: readonly (THREE.Mesh | null)[], reach: number): number => {
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
  return hover;
};
