import type { DressingColliderPart } from "../types";

/**
 * TRAFFIC SIGNAL SPEC — the numbers, with no Three: pole, mast arm and head
 * boxes, their collider parts, the default intersection chance. TrafficLights.tsx
 * builds the art and mounts the colliders from these; the SERVER
 * (physics/obstacles.ts) builds identical colliders from the same enumerator
 * (getCityTrafficLightPoints) — one source.
 */

export const POLE_HEIGHT = 7.6;
// Collider half-width: a touch proud of the 0.2u pole so you cannot clip its
// corner, and it swallows the 0.5u base (0.4u tall — steppable, not worth a
// second shape).
export const POLE_HALF_WIDTH = 0.14;
export const ARM_LENGTH = 3.2; // toward the intersection — hangs the head over the curb

/** Mast arm + signal head as boxes, in POLE-LOCAL space (+X toward the
 *  intersection), shared by the geometry and by their colliders. */
export const SIGNAL_PARTS = {
  arm: { w: ARM_LENGTH, h: 0.15, d: 0.15, x: ARM_LENGTH / 2, y: POLE_HEIGHT - 0.15 },
  head: { w: 0.45, h: 2.0, d: 0.75, x: ARM_LENGTH, y: POLE_HEIGHT - 1.25 },
};

/** Pole, mast arm and signal head, all solid. The LAMPS get nothing — they
 *  sit on the head's face and are already inside its box. */
export const SIGNAL_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: POLE_HALF_WIDTH * 2, h: POLE_HEIGHT, d: POLE_HALF_WIDTH * 2, x: 0, y: POLE_HEIGHT / 2 },
  SIGNAL_PARTS.arm,
  SIGNAL_PARTS.head,
];

/** Fraction of qualifying intersections that get signals (the `chance` prop). */
export const SIGNAL_DEFAULT_CHANCE = 0.45;
