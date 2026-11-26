import type { Vec3Tuple } from "../../net/protocol/types";
import type { DECAL_KINDS } from "./enums";

export type DecalKind = (typeof DECAL_KINDS)[number];

/** One decal asked for, waiting for the driver's next frame (Decals.tsx). */
export interface DecalStamp {
  kind: DecalKind;
  /** On the surface (world). */
  at: Vec3Tuple;
  /** The surface's normal there (unit, world): the decal lies across it. */
  normal: Vec3Tuple;
  /** Its width (u). */
  size: number;
}

/** How a kind of decal looks and lasts (material.ts draws its shape). */
export interface DecalLook {
  key: DecalKind;
  /** Its shape and colour: GLSL that sets `decalColor` (rgb, a) from `p` (the quad, -1..1 each way) and
   *  `seed` (0..1, the decal's own: no two alike), or discards. */
  shape: string;
  /** How long it lies (s), shrinking away over its last DECAL_SHRINK_SECONDS. */
  seconds: number;
  /** Drawn at once at most: past it the oldest batch gives way. */
  capacity: number;
}
