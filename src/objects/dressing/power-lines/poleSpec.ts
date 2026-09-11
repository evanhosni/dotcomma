import type { DressingColliderPart } from "../types";

/**
 * UTILITY POLE SPEC — the numbers, with no Three: post + crossarm boxes,
 * their collider parts, the default placement along freeways. PowerLines.tsx
 * builds the art and mounts the colliders from these; the SERVER
 * (physics/obstacles.ts) builds identical colliders from the same enumerator
 * (getCityFreewaySidePoints) — one source.
 */

export const POLE_HEIGHT = 11;
// Collider half-width: a touch proud of the 0.3u pole so its corner can't be
// clipped. The WIRES are deliberately left non-solid — they hang at pole height
// across the freeway, and a collider on them would be an invisible wall in
// mid-air; the post and its crossarm are solid, the spans between them are not.
export const POLE_HALF_WIDTH = 0.19;
export const ARM_HALF = 1.7; // crossarm half-length (perpendicular to the wires)
// Crossarm box, shared by the GEOMETRY and its COLLIDER so the two can't drift
// apart when the art changes. Runs along the pole's local Z (across the run),
// which is why its collider has to inherit the instance's yaw.
export const ARM_THICKNESS = 0.2; // along local X
export const ARM_DEPTH = 0.25; // vertical
export const ARM_Y = POLE_HEIGHT - 0.85; // center height

/** Post + crossarm, both solid (the post is square in plan, so the body's yaw
 *  only matters for the crossarm, which runs across the wires). */
export const POLE_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: POLE_HALF_WIDTH * 2, h: POLE_HEIGHT, d: POLE_HALF_WIDTH * 2, x: 0, y: POLE_HEIGHT / 2 },
  { w: ARM_THICKNESS, h: ARM_DEPTH, d: ARM_HALF * 2, x: 0, y: ARM_Y },
];

/** Default placement (PowerLines props override per mount — the server mirrors
 *  the CITY biome's mount, which uses these defaults). `lateral` = the freeway
 *  half-width + lateralMargin, resolved from the domain's cityConfig. */
export const POLE_PLACEMENT = {
  /** Pole spacing along the freeway (world units). */
  spacing: 55,
  /** Pole line offset past the freeway edge — lands on the sidewalk band. */
  lateralMargin: 5,
  /** Skip candidates this close to a crossing freeway (runs end before interchanges). */
  junctionClear: 26,
  /** Only ONE side of each freeway carries poles. */
  side: 1,
};
