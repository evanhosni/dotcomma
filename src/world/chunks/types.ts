/**
 * THE WORLD'S STREAMING CHUNK GRID, as data. Fixed 256u cells the camera drags a window over —
 * what the dressing, the tunnels and anything else streamed by position is built in. (Terrain has
 * its own chunks, sized per LOD level: world/terrain/lodConfig.ts. These are not those.)
 *
 * NO Three/React here — the SERVER imports this to build the same colliders.
 */

import type { RectXZ } from "../../utils/math/types";

/** A box in instance-local space (+X along the arm, y up); `x`/`y`/`z` are the box center (z defaults to 0)
 *  and `yaw` turns it about the local y axis (a bridge parapet segment runs along its wall, not its chord). */
export interface ColliderPart {
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
 *  drawn slab and walls are, exactly — or a rock's lump. */
export interface ColliderMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Walked at full speed whatever its slope, by the player and every server NPC. */
  fullSpeedSlope?: boolean;
}

/** One fixed body: rotation = yaw about y after `pitch` about local Z (Euler XYZ [0, yaw, pitch]).
 *  `parts` overrides the feature's shared boxes (bridge chords differ per body); `mesh`, when present,
 *  is one more collider of the body — a body may be solid through its mesh alone (a rock). */
export interface ColliderBody {
  /** Unique among the feature's bodies; default `${x}_${z}`. A feature whose bodies can share a position
   *  (a tunnel's columns: two neighbouring chunks each own a column centred at the same x, z) must set it,
   *  or the client builds one of them and drops the other (chunks/colliders.tsx reports it). */
  key?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
  parts?: ColliderPart[];
  mesh?: ColliderMesh;
}

/** How far a streamed system draws, and how far its chunks are solid. Every system mounting one
 *  takes these; unset = its own default. */
export interface ChunkViewProps {
  renderDistance?: number;
  colliderDistance?: number;
}

/** A chunk's horizontal rectangle (the shared RectXZ). */
export type ChunkBounds = RectXZ;

/** rotateY(θ) maps +X to (cosθ, 0, −sinθ) — the yaw aligning local +X with a direction. */
export const yawFromDir = (dirX: number, dirZ: number): number => Math.atan2(-dirZ, dirX);

/** Client and server MUST chunk identically: belt-freeway coverage depends on the query center's wall set. */
export const WORLD_CHUNK_SIZE = 256;
