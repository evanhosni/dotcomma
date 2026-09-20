/** NO Three/React here — the server (physics/obstacles.ts) imports this to build the same colliders. */

/** A box in instance-local space (+X along the arm, y up); `x`/`y` are the box center. */
export interface DressingColliderPart {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
}

/** rotateY(θ) maps +X to (cosθ, 0, −sinθ) — the yaw aligning local +X with a direction. */
export const yawFromDir = (dirX: number, dirZ: number): number => Math.atan2(-dirZ, dirX);

/** Client and server MUST chunk identically: belt-freeway coverage depends on the query center's wall set. */
export const DRESSING_CHUNK_SIZE = 256;
