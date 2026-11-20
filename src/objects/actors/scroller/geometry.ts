import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry";
import { FRONT_WHEEL_WIDTH, REAR_WHEEL_WIDTH, SCROLLER_HULL, SCROLLER_SHAPE } from "./spec";

/** The shell is the collider's own convex hull, so what you see is what you hit. */
export const SCROLLER_SHELL_GEOMETRY = new ConvexGeometry(SCROLLER_HULL.map(([x, y, z]) => new THREE.Vector3(x, y, z)));

/** A ribbed scroll wheel: few sides, axis along x. */
const wheelGeometry = (radius: number, width: number, sides: number): THREE.BufferGeometry => {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, sides, 1);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
};

const [front, rear] = SCROLLER_SHAPE.wheels;
export const SCROLLER_FRONT_WHEEL_GEOMETRY = wheelGeometry(front.radius, FRONT_WHEEL_WIDTH, 10);
export const SCROLLER_REAR_WHEEL_GEOMETRY = wheelGeometry(rear.radius, REAR_WHEEL_WIDTH, 6);

/** The click target: the shell's box, wheel included. */
export const SCROLLER_BOUNDS = new THREE.Box3().setFromBufferAttribute(SCROLLER_SHELL_GEOMETRY.getAttribute("position") as THREE.BufferAttribute).expandByPoint(
  new THREE.Vector3(0, front.radius * 2, front.z + front.radius),
);
export const SCROLLER_BOUNDS_RADIUS = SCROLLER_BOUNDS.getBoundingSphere(new THREE.Sphere()).radius;
