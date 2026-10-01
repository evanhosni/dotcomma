import { yawFromDir, type DressingColliderPart, type DressingColliderSpec } from "../types";

// Three-free: the art (PowerLines.tsx) and the client + SERVER colliders (physics/obstacles.ts)
// are all built from these numbers.

export const UTILITY_POLE_HEIGHT = 11;
// Collider a touch proud of the 0.3u pole so its corner can't be clipped.
const UTILITY_POLE_HALF_WIDTH = 0.19;
export const CROSSARM_HALF_LENGTH = 1.7; // runs along local Z, across the wires
export const CROSSARM_THICKNESS = 0.2; // along local X
export const CROSSARM_DEPTH = 0.25; // vertical
export const CROSSARM_Y = UTILITY_POLE_HEIGHT - 0.85; // center height

/** Post + crossarm only. The WIRES are deliberately NOT solid: a collider at pole height
 *  across the freeway is an invisible wall. */
const UTILITY_POLE_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: UTILITY_POLE_HALF_WIDTH * 2, h: UTILITY_POLE_HEIGHT, d: UTILITY_POLE_HALF_WIDTH * 2, x: 0, y: UTILITY_POLE_HEIGHT / 2 },
  { w: CROSSARM_THICKNESS, h: CROSSARM_DEPTH, d: CROSSARM_HALF_LENGTH * 2, x: 0, y: CROSSARM_Y },
];

export const UTILITY_POLE_PLACEMENT = {
  spacing: 55,
  /** Past the freeway edge; 5 lands the poles on the sidewalk band. */
  lateralMargin: 5,
  /** Runs stop this close to a crossing freeway. */
  junctionClear: 26,
  /** Only one side of each freeway carries poles. */
  side: 1,
};

export const POWER_LINES_SPEC: DressingColliderSpec<"freewayEdgePoints"> = {
  id: "PowerLines",
  enumerator: "freewayEdgePoints",
  placement: UTILITY_POLE_PLACEMENT,
  colliderParts: UTILITY_POLE_COLLIDER_PARTS,
  bodiesOf: (p) => [{ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ) }],
};
