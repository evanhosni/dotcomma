/** NO Three/React here — the server (physics/obstacles.ts) imports this to build the same colliders. */

import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";

/** A box in instance-local space (+X along the arm, y up); `x`/`y`/`z` are the box center (z defaults to 0)
 *  and `yaw` turns it about the local y axis (a bridge parapet segment runs along its wall, not its chord). */
export interface DressingColliderPart {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z?: number;
  yaw?: number;
  /** Walked at full speed whatever its slope, by the player and every server NPC (a ramp, stairs). */
  fullSpeedSlope?: boolean;
}

/** A triangle mesh in body-local space (xyz triples, three indices per triangle): what a bridge chord's
 *  drawn slab and walls are, exactly. */
export interface DressingColliderMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Walked at full speed whatever its slope, by the player and every server NPC. */
  fullSpeedSlope?: boolean;
}

/** One fixed body: rotation = yaw about y after `pitch` about local Z (Euler XYZ [0, yaw, pitch]).
 *  `parts` overrides the feature's shared boxes (bridge chords differ per body); `mesh`, when present,
 *  is one more collider of the body. */
export interface DressingColliderBody {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
  parts?: DressingColliderPart[];
  mesh?: DressingColliderMesh;
}

/** A dressing feature with colliders, as data the client component AND the server read — listed in
 *  catalog.ts. `placement` is the mount's prop defaults and the ONLY placement the server knows. */
export interface DressingColliderSpec<K extends DressingEnumeratorName = DressingEnumeratorName> {
  /** The feature's component name (dev warnings). */
  id: string;
  enumerator: K;
  placement: EnumeratorArgs<K>;
  /** Boxes every body shares, unless the body carries its own. */
  colliderParts: DressingColliderPart[];
  /** A placed point → its bodies; the yaw must match the drawn instance. */
  bodiesOf(point: EnumeratorPoint<K>): DressingColliderBody[];
}

export interface DressingBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** rotateY(θ) maps +X to (cosθ, 0, −sinθ) — the yaw aligning local +X with a direction. */
export const yawFromDir = (dirX: number, dirZ: number): number => Math.atan2(-dirZ, dirX);

/** Client and server MUST chunk identically: belt-freeway coverage depends on the query center's wall set. */
export const DRESSING_CHUNK_SIZE = 256;
