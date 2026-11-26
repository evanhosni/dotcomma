import * as THREE from "three";
import { boneNamed, skeletonLayoutOf } from "../ragdoll/utils";
import { mavGeometries } from "./geometry";
import { mavMaterials } from "./material";
import { MAV_HOST_BONE, MAV_SCREW_LENGTH, MAV_SEAT_SINK } from "./spec";
import { ATTACHMENT_FLAG } from "../model/store";
import type { MavSeat } from "./types";

/** One MAV Unit to draw: its parts share the module's geometry and materials. */
export const createMavUnit = (): THREE.Group => {
  const g = mavGeometries();
  const m = mavMaterials();
  const unit = new THREE.Group();
  unit.name = "mav-unit";
  unit.userData[ATTACHMENT_FLAG] = true;
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [g.head, m.body],
    [g.collar, m.trim],
    [g.window, m.window],
    [g.rim, m.trim],
    [g.grid, m.trim],
    [g.antenna, m.trim],
    [g.bulb, m.bulb],
    [g.shank, m.screw],
    [g.thread, m.screw],
  ];
  for (const [geometry, material] of parts) unit.add(new THREE.Mesh(geometry, material));
  return unit;
};

const _matrix = new THREE.Matrix4();
const _forward = new THREE.Vector3();
const _side = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** The seat on a host model's MAV_HOST_BONE; null for a model without one. */
export const mavSeatOf = (model: THREE.Object3D): MavSeat | null => {
  const bone = boneNamed(model, MAV_HOST_BONE);
  const layout = skeletonLayoutOf(model);
  const shape = layout?.shapes.get(MAV_HOST_BONE);
  const toBone = layout?.modelToBone.get(MAV_HOST_BONE);
  if (!bone || !shape || !toBone) return null;
  // The model's up and forward (+y, +z) as directions in the bone's space.
  _matrix.extractRotation(toBone);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(_matrix).normalize();
  _forward.set(0, 0, 1).applyMatrix4(_matrix);
  _forward.addScaledVector(up, -_forward.dot(up)).normalize();
  _side.crossVectors(up, _forward);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(_matrix.makeBasis(_side, up, _forward));
  // The top of the head along `up`: the box's centre pushed out to its face in that direction.
  const center = _a.addVectors(shape.min, shape.max).multiplyScalar(0.5);
  const half = _b.subVectors(shape.max, shape.min).multiplyScalar(0.5);
  const reach = Math.abs(up.x) * half.x + Math.abs(up.y) * half.y + Math.abs(up.z) * half.z;
  const point = center.clone().addScaledVector(up, reach - MAV_SEAT_SINK);
  model.updateWorldMatrix(true, true);
  const scale = model.getWorldScale(_a).x / bone.getWorldScale(_b).x;
  return { bone, point, up, rotation, scale };
};

/** Hangs the unit on its seat, `depth` (0–1) of its screw into the skull, turned `spin` radians about its axis. */
export const poseOnSeat = (unit: THREE.Object3D, seat: MavSeat, depth: number, spin: number): void => {
  if (unit.parent !== seat.bone) seat.bone.add(unit);
  unit.position.copy(seat.point).addScaledVector(seat.up, MAV_SCREW_LENGTH * (1 - depth) * seat.scale);
  unit.quaternion.copy(seat.rotation).multiply(_spin.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spin));
  unit.scale.setScalar(seat.scale);
};

/** Where the seat is in the world now (the host's head as it is posed). */
export const seatWorldPoint = (seat: MavSeat, out: THREE.Vector3): THREE.Vector3 => {
  seat.bone.updateWorldMatrix(true, false);
  return out.copy(seat.point).applyMatrix4(seat.bone.matrixWorld);
};

/** Stands the unit on its own under `parent`: its origin at (x, y, z), turned `spin` radians about its axis. */
export const poseAlone = (unit: THREE.Object3D, parent: THREE.Object3D, x: number, y: number, z: number, spin: number): void => {
  if (unit.parent !== parent) parent.add(unit);
  unit.position.set(x, y, z);
  unit.rotation.set(0, spin, 0);
  unit.scale.setScalar(1);
};
