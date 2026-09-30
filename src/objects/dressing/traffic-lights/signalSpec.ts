import { yawFromDir, type DressingColliderPart, type DressingColliderSpec } from "../types";

// Three-free: the art (TrafficLights.tsx) and the client + SERVER colliders (physics/obstacles.ts)
// are all built from these numbers.

export const SIGNAL_POLE_HEIGHT = 7.6;
// Collider a touch proud of the 0.2u pole so its corner can't be clipped; the 0.4u-tall base is steppable.
export const SIGNAL_POLE_HALF_WIDTH = 0.14;
export const SIGNAL_ARM_LENGTH = 3.2; // hangs the head over the curb

/** Pole-local space, +X toward the intersection. */
export const SIGNAL_PARTS = {
  arm: { w: SIGNAL_ARM_LENGTH, h: 0.15, d: 0.15, x: SIGNAL_ARM_LENGTH / 2, y: SIGNAL_POLE_HEIGHT - 0.15 },
  head: { w: 0.45, h: 2.0, d: 0.75, x: SIGNAL_ARM_LENGTH, y: SIGNAL_POLE_HEIGHT - 1.25 },
};

/** The lamps sit inside the head's box, so they get no part of their own. */
export const SIGNAL_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: SIGNAL_POLE_HALF_WIDTH * 2, h: SIGNAL_POLE_HEIGHT, d: SIGNAL_POLE_HALF_WIDTH * 2, x: 0, y: SIGNAL_POLE_HEIGHT / 2 },
  SIGNAL_PARTS.arm,
  SIGNAL_PARTS.head,
];

export const SIGNAL_PLACEMENT = { chance: 0.45 };

export const TRAFFIC_LIGHTS_SPEC: DressingColliderSpec<"trafficLights"> = {
  id: "TrafficLights",
  enumerator: "trafficLights",
  placement: SIGNAL_PLACEMENT,
  colliderParts: SIGNAL_COLLIDER_PARTS,
  bodiesOf: (p) => [{ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ) }],
};
