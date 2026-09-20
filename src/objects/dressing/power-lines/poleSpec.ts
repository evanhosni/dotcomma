import type { DressingColliderPart } from "../types";

// Three-free: the art (PowerLines.tsx) and the client + SERVER colliders (physics/obstacles.ts)
// are all built from these numbers.

export const POLE_HEIGHT = 11;
// Collider a touch proud of the 0.3u pole so its corner can't be clipped.
export const POLE_HALF_WIDTH = 0.19;
export const ARM_HALF = 1.7; // crossarm runs along local Z, across the wires
export const ARM_THICKNESS = 0.2; // along local X
export const ARM_DEPTH = 0.25; // vertical
export const ARM_Y = POLE_HEIGHT - 0.85; // center height

/** Post + crossarm only. The WIRES are deliberately NOT solid: a collider at pole height
 *  across the freeway is an invisible wall. */
export const POLE_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: POLE_HALF_WIDTH * 2, h: POLE_HEIGHT, d: POLE_HALF_WIDTH * 2, x: 0, y: POLE_HEIGHT / 2 },
  { w: ARM_THICKNESS, h: ARM_DEPTH, d: ARM_HALF * 2, x: 0, y: ARM_Y },
];

/** The server mirrors the city biome's mount, which uses these defaults. */
export const POLE_PLACEMENT = {
  spacing: 55,
  /** Past the freeway edge; 5 lands the poles on the sidewalk band. */
  lateralMargin: 5,
  /** Runs stop this close to a crossing freeway. */
  junctionClear: 26,
  /** Only one side of each freeway carries poles. */
  side: 1,
};
