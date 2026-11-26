import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { BARREL_LENGTH, BARREL_RADIUS, BORE_Y, DRUM_LENGTH, DRUM_RADIUS, GRIP_LENGTH } from "./constants";

/** The revolver's placeholder shapes until its GLB exists, around its origin at the hand: the bore along +z at
 *  BORE_Y, the grip down and back. Metal (barrel, drum, frame, hammer, trigger) and wood (the grip). */
let shapes: { metal: THREE.BufferGeometry; wood: THREE.BufferGeometry } | null = null;

export const revolverGeometries = () => {
  if (shapes) return shapes;
  const drumZ = 0.02;
  const barrel = new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_LENGTH, 8)
    .rotateX(Math.PI / 2)
    .translate(0, BORE_Y, drumZ + DRUM_LENGTH / 2 + BARREL_LENGTH / 2);
  const rib = new THREE.BoxGeometry(BARREL_RADIUS, BARREL_RADIUS * 1.2, BARREL_LENGTH)
    .translate(0, BORE_Y + BARREL_RADIUS * 0.9, drumZ + DRUM_LENGTH / 2 + BARREL_LENGTH / 2);
  const drum = new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, DRUM_LENGTH, 6).rotateX(Math.PI / 2).translate(0, BORE_Y - DRUM_RADIUS * 0.35, drumZ);
  const frame = new THREE.BoxGeometry(DRUM_RADIUS * 1.3, DRUM_RADIUS * 1.6, DRUM_LENGTH * 1.9).translate(0, BORE_Y - DRUM_RADIUS * 0.5, drumZ - DRUM_LENGTH * 0.2);
  const hammer = new THREE.BoxGeometry(0.012, 0.03, 0.02).rotateX(-0.5).translate(0, BORE_Y + 0.012, drumZ - DRUM_LENGTH);
  const trigger = new THREE.BoxGeometry(0.008, 0.03, 0.008).rotateX(0.3).translate(0, BORE_Y - DRUM_RADIUS * 1.6, drumZ - 0.005);
  const guard = new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(0, BORE_Y - DRUM_RADIUS * 1.3, drumZ - 0.005);
  const grip = new THREE.BoxGeometry(DRUM_RADIUS * 1.1, GRIP_LENGTH, 0.04)
    .translate(0, -GRIP_LENGTH / 2, 0)
    .rotateX(-0.35)
    .translate(0, BORE_Y - DRUM_RADIUS * 0.9, drumZ - DRUM_LENGTH * 0.95);
  shapes = {
    metal: mergeGeometries([barrel, rib, drum, frame, hammer, trigger, guard].map((g) => g.toNonIndexed()))!,
    wood: grip.toNonIndexed(),
  };
  return shapes;
};
