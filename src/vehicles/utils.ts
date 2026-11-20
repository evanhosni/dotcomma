import type Rapier from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { LiveVehicle } from "./types";

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** The body's rotation as a THREE quaternion, into `out`. */
export const bodyQuaternion = (body: Rapier.RigidBody, out: THREE.Quaternion): THREE.Quaternion => {
  const r = body.rotation();
  return out.set(r.x, r.y, r.z, r.w);
};

/** The car's heading, radians (atan2(x, z) of its nose). */
export const headingOf = (body: Rapier.RigidBody): number => {
  _v.set(0, 0, 1).applyQuaternion(bodyQuaternion(body, _q));
  return Math.atan2(_v.x, _v.z);
};

/** The driver's seat in world space, into `out`. */
export const seatPositionOf = (car: LiveVehicle, out: THREE.Vector3): THREE.Vector3 => {
  const { body } = car.vehicle;
  const t = body.translation();
  return out.set(car.seat.x, car.seat.y, car.seat.z).applyQuaternion(bodyQuaternion(body, _q)).add(_v.set(t.x, t.y, t.z));
};
