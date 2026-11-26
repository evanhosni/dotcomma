import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { MAV_ANTENNA_HEIGHT, MAV_BULB_RADIUS, MAV_HEAD_HEIGHT, MAV_HEAD_RADIUS, MAV_SCREW_LENGTH, MAV_SCREW_RADIUS } from "./spec";

/** The placeholder's shapes, around the unit's origin (spec.ts): a hexagonal head with a round gridded window
 *  on its front (+z) face, a thin antenna with a bulb, a tapered screw with a helical thread underneath. */

const WINDOW_RADIUS = MAV_HEAD_HEIGHT * 0.32;
const WINDOW_RIM = 0.009;
const GRID_BAR = 0.006;
const ANTENNA_RADIUS = 0.008;
const THREAD_TURNS = 3.5;
const THREAD_RADIUS = 0.013;
const SEGMENTS = 16;

/** A hexagon's flat face lies this far from its centre. */
const HEAD_APOTHEM = MAV_HEAD_RADIUS * Math.cos(Math.PI / 6);

/** The thread winds down the shank, narrowing with it, and stops short of the tip. */
class Helix extends THREE.Curve<THREE.Vector3> {
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const y = -t * MAV_SCREW_LENGTH * 0.92;
    const r = MAV_SCREW_RADIUS * (1 - t * 0.92) + THREAD_RADIUS * 0.4;
    const a = t * THREAD_TURNS * Math.PI * 2;
    return target.set(Math.sin(a) * r, y, Math.cos(a) * r);
  }
}

let shapes: Record<"head" | "window" | "rim" | "grid" | "antenna" | "bulb" | "shank" | "thread" | "collar", THREE.BufferGeometry> | null = null;

export const mavGeometries = () => {
  if (shapes) return shapes;
  // Corners at ±x: a flat face toward +z for the window.
  const head = new THREE.CylinderGeometry(MAV_HEAD_RADIUS, MAV_HEAD_RADIUS, MAV_HEAD_HEIGHT, 6).rotateY(Math.PI / 6).translate(0, MAV_HEAD_HEIGHT / 2, 0);
  const face = HEAD_APOTHEM + 0.002;
  const windowY = MAV_HEAD_HEIGHT / 2;
  const window = new THREE.CircleGeometry(WINDOW_RADIUS, SEGMENTS * 2).translate(0, windowY, face);
  const rim = new THREE.TorusGeometry(WINDOW_RADIUS, WINDOW_RIM, 6, SEGMENTS * 2).translate(0, windowY, face);
  const bar = WINDOW_RADIUS * 1.9;
  // Two bars each way, a third of the radius off centre: the drawing's 3 × 3 grid.
  const grid = mergeGeometries(
    [-1, 1].flatMap((side) => {
      const offset = (side * WINDOW_RADIUS) / 3;
      return [
        new THREE.BoxGeometry(GRID_BAR, bar, GRID_BAR).translate(offset, windowY, face + GRID_BAR / 2),
        new THREE.BoxGeometry(bar, GRID_BAR, GRID_BAR).translate(0, windowY + offset, face + GRID_BAR / 2),
      ];
    }),
  )!;
  const antenna = new THREE.CylinderGeometry(ANTENNA_RADIUS, ANTENNA_RADIUS, MAV_ANTENNA_HEIGHT, 6).translate(0, MAV_HEAD_HEIGHT + MAV_ANTENNA_HEIGHT / 2, 0);
  const bulb = new THREE.SphereGeometry(MAV_BULB_RADIUS, 12, 8).translate(0, MAV_HEAD_HEIGHT + MAV_ANTENNA_HEIGHT + MAV_BULB_RADIUS * 0.6, 0);
  const shank = new THREE.ConeGeometry(MAV_SCREW_RADIUS, MAV_SCREW_LENGTH, SEGMENTS).rotateX(Math.PI).translate(0, -MAV_SCREW_LENGTH / 2, 0);
  const thread = new THREE.TubeGeometry(new Helix(), 96, THREAD_RADIUS, 5, false);
  const collar = new THREE.CylinderGeometry(MAV_SCREW_RADIUS * 1.25, MAV_SCREW_RADIUS * 1.25, 0.03, SEGMENTS).translate(0, -0.015, 0);
  shapes = { head, window, rim, grid, antenna, bulb, shank, thread, collar };
  return shapes;
};

