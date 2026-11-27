import * as THREE from "three";
import { mergeParts } from "../utils";
import { BLADE_LENGTH, BLADE_THICKNESS, BLADE_WIDTH, GUARD_WIDTH, HANDLE_LENGTH, TIP_LENGTH } from "./constants";

let shapes: { blade: THREE.BufferGeometry; metal: THREE.BufferGeometry; grip: THREE.BufferGeometry } | null = null;

/** The sword's placeholder shapes until its GLB exists, around the middle of its handle: a straight
 *  double-edged blade along +z flat across x, its diamond tip, a cross guard and a pommel. */
export const swordGeometries = () => {
  if (shapes) return shapes;
  const bladeStart = HANDLE_LENGTH / 2 + 0.015;
  const blade = new THREE.BoxGeometry(BLADE_WIDTH, BLADE_THICKNESS, BLADE_LENGTH).translate(0, 0, bladeStart + BLADE_LENGTH / 2);
  const tip = new THREE.ConeGeometry(BLADE_WIDTH / Math.SQRT2, TIP_LENGTH, 4)
    .rotateY(Math.PI / 4)
    .rotateX(Math.PI / 2)
    .scale(1, (BLADE_THICKNESS / BLADE_WIDTH) * Math.SQRT2, 1)
    .translate(0, 0, bladeStart + BLADE_LENGTH + TIP_LENGTH / 2);
  const guard = new THREE.BoxGeometry(GUARD_WIDTH, 0.028, 0.03).translate(0, 0, HANDLE_LENGTH / 2);
  const pommel = new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0, -HANDLE_LENGTH / 2 - 0.02);
  const handle = new THREE.CylinderGeometry(0.018, 0.02, HANDLE_LENGTH, 8).rotateX(Math.PI / 2);
  shapes = { blade: mergeParts([blade, tip]), metal: mergeParts([guard, pommel]), grip: handle.toNonIndexed() };
  return shapes;
};
