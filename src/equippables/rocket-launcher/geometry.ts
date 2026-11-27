import * as THREE from "three";
import { mergeParts } from "../utils";
import { MUZZLE, ROCKET_LENGTH, ROCKET_RADIUS, TUBE_LENGTH, TUBE_RADIUS, TUBE_Y, TUBE_Z, WARHEAD_LENGTH } from "./constants";

let launcher: { drab: THREE.BufferGeometry; metal: THREE.BufferGeometry; grip: THREE.BufferGeometry } | null = null;
let rocket: { drab: THREE.BufferGeometry; metal: THREE.BufferGeometry } | null = null;

/** The warhead: a cone along +z ending at z 0. */
const warhead = (): THREE.BufferGeometry =>
  new THREE.ConeGeometry(ROCKET_RADIUS * 1.15, WARHEAD_LENGTH, 8).rotateX(Math.PI / 2).translate(0, 0, -WARHEAD_LENGTH / 2);

/** The launcher's placeholder shapes until its GLB exists, around its front grip: an olive tube along +z with
 *  flared ends, the loaded rocket's warhead in its mouth, a sight on its left, two grips under it. */
export const rocketLauncherGeometries = () => {
  if (launcher) return launcher;
  const tube = new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, TUBE_LENGTH, 12, 1, true).rotateX(Math.PI / 2).translate(0, TUBE_Y, TUBE_Z);
  const front = new THREE.CylinderGeometry(TUBE_RADIUS * 1.25, TUBE_RADIUS, 0.08, 12, 1, true).rotateX(Math.PI / 2).translate(0, TUBE_Y, TUBE_Z + TUBE_LENGTH / 2 + 0.03);
  const back = new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS * 1.3, 0.1, 12, 1, true).rotateX(Math.PI / 2).translate(0, TUBE_Y, TUBE_Z - TUBE_LENGTH / 2 - 0.04);
  const tip = warhead().translate(MUZZLE[0], MUZZLE[1], MUZZLE[2] + WARHEAD_LENGTH * 0.4);
  const sight = new THREE.BoxGeometry(0.02, 0.06, 0.07).translate(-TUBE_RADIUS - 0.012, TUBE_Y + 0.03, TUBE_Z + 0.08);
  const rails = new THREE.BoxGeometry(0.03, 0.02, 0.4).translate(0, TUBE_Y - TUBE_RADIUS - 0.008, TUBE_Z - 0.1);
  const grip = new THREE.BoxGeometry(0.032, 0.11, 0.045).translate(0, 0.005, 0).rotateX(-0.2);
  const rearGrip = new THREE.BoxGeometry(0.032, 0.1, 0.045).translate(0, 0.01, -0.24).rotateX(-0.25);
  launcher = { drab: mergeParts([tube, front, back]), metal: mergeParts([tip, sight, rails]), grip: mergeParts([grip, rearGrip]) };
  return launcher;
};

/** The rocket in flight, its nose at the origin and its body back along −z: an olive body, a steel warhead,
 *  four fins. */
export const rocketGeometries = () => {
  if (rocket) return rocket;
  const body = new THREE.CylinderGeometry(ROCKET_RADIUS, ROCKET_RADIUS, ROCKET_LENGTH, 8).rotateX(Math.PI / 2).translate(0, 0, -WARHEAD_LENGTH - ROCKET_LENGTH / 2);
  const fins = [0, 1, 2, 3].map((i) =>
    new THREE.BoxGeometry(0.006, ROCKET_RADIUS * 3, 0.08)
      .translate(0, 0, -WARHEAD_LENGTH - ROCKET_LENGTH + 0.04)
      .rotateZ((i * Math.PI) / 2),
  );
  rocket = { drab: mergeParts([body, ...fins]), metal: warhead().toNonIndexed() };
  return rocket;
};
