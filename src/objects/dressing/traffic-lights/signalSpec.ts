import type { DressingColliderPart } from "../types";

// Three-free: the art (TrafficLights.tsx) and the client + SERVER colliders (physics/obstacles.ts)
// are all built from these numbers.

export const POLE_HEIGHT = 7.6;
// Collider a touch proud of the 0.2u pole so its corner can't be clipped; the 0.4u-tall base is steppable.
export const POLE_HALF_WIDTH = 0.14;
export const ARM_LENGTH = 3.2; // hangs the head over the curb

/** Pole-local space, +X toward the intersection. */
export const SIGNAL_PARTS = {
  arm: { w: ARM_LENGTH, h: 0.15, d: 0.15, x: ARM_LENGTH / 2, y: POLE_HEIGHT - 0.15 },
  head: { w: 0.45, h: 2.0, d: 0.75, x: ARM_LENGTH, y: POLE_HEIGHT - 1.25 },
};

/** The lamps sit inside the head's box, so they get no part of their own. */
export const SIGNAL_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: POLE_HALF_WIDTH * 2, h: POLE_HEIGHT, d: POLE_HALF_WIDTH * 2, x: 0, y: POLE_HEIGHT / 2 },
  SIGNAL_PARTS.arm,
  SIGNAL_PARTS.head,
];

export const SIGNAL_DEFAULT_CHANCE = 0.45;
