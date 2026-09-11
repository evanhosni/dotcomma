/**
 * Dressing types and helpers with NO Three/React — importable by the server
 * (server/src/game/physics/obstacles.ts builds the same collider boxes the
 * client mounts, from the same spec files).
 */

/** A solid box of a dressing piece in INSTANCE-LOCAL space (+X along the
 *  arm/crossarm, y up): the same numbers its geometry is built from, so the
 *  collider can never drift from the art. `x`/`y` are the box CENTER. */
export interface DressingColliderPart {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
}

/** rotateY(θ) maps +X to (cosθ, 0, −sinθ) — the yaw aligning local +X with a direction. */
export const yawFromDir = (dirX: number, dirZ: number): number => Math.atan2(-dirZ, dirX);

/** World units per dressing chunk (one build call). Here, not in Dressing.tsx,
 *  because the SERVER enumerates the same chunks (belt-freeway coverage depends
 *  on the query center's wall set, so both sides must use one size). */
export const DRESSING_CHUNK_SIZE = 256;
