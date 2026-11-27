import * as THREE from "three";
import { mergeParts } from "../utils";
import { BARREL_LENGTH, BARREL_RADIUS, BORE_Y, RECEIVER_FRONT, RECEIVER_LENGTH } from "./constants";

let shapes: { metal: THREE.BufferGeometry; wood: THREE.BufferGeometry } | null = null;

/** The AK-47's placeholder shapes until its GLB exists, around its pistol grip: the bore along +z at BORE_Y,
 *  the curved magazine down and forward, the stock back. Metal (receiver, barrel, gas tube, sight, magazine,
 *  guard) and wood (handguard, grip, stock). */
export const ak47Geometries = () => {
  if (shapes) return shapes;
  const receiverZ = RECEIVER_FRONT - RECEIVER_LENGTH / 2;
  const receiver = new THREE.BoxGeometry(0.045, 0.07, RECEIVER_LENGTH).translate(0, BORE_Y - 0.015, receiverZ);
  const barrel = new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_LENGTH, 8)
    .rotateX(Math.PI / 2)
    .translate(0, BORE_Y, RECEIVER_FRONT + BARREL_LENGTH / 2);
  const gasTube = new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6).rotateX(Math.PI / 2).translate(0, BORE_Y + 0.022, RECEIVER_FRONT + 0.1);
  const sight = new THREE.BoxGeometry(0.008, 0.04, 0.012).translate(0, BORE_Y + 0.025, RECEIVER_FRONT + BARREL_LENGTH - 0.03);
  const rearSight = new THREE.BoxGeometry(0.03, 0.02, 0.04).translate(0, BORE_Y + 0.028, RECEIVER_FRONT - 0.03);
  const magazineTop = new THREE.BoxGeometry(0.032, 0.12, 0.06).rotateX(-0.25).translate(0, BORE_Y - 0.11, 0.12);
  const magazineBottom = new THREE.BoxGeometry(0.032, 0.1, 0.058).rotateX(-0.55).translate(0, BORE_Y - 0.205, 0.155);
  const guard = new THREE.TorusGeometry(0.025, 0.004, 4, 10, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(0, BORE_Y - 0.05, 0.035);
  const handguard = new THREE.BoxGeometry(0.055, 0.05, 0.19).translate(0, BORE_Y - 0.004, RECEIVER_FRONT + 0.1);
  const pistolGrip = new THREE.BoxGeometry(0.034, 0.11, 0.045).translate(0, -0.03, 0).rotateX(-0.3);
  const stock = new THREE.BoxGeometry(0.04, 0.075, 0.27).rotateX(0.1).translate(0, BORE_Y - 0.045, receiverZ - RECEIVER_LENGTH / 2 - 0.13);
  shapes = {
    metal: mergeParts([receiver, barrel, gasTube, sight, rearSight, magazineTop, magazineBottom, guard]),
    wood: mergeParts([handguard, pistolGrip, stock]),
  };
  return shapes;
};
