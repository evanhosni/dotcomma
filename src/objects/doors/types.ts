/** Three-free: building specs, which the server imports, name a handle. */

/** Drawn on both faces of every door leaf, on the side away from the hinge. */
export interface DoorHandle {
  /** A lever pointing at the hinge; otherwise a round knob. */
  lever: boolean;
  color: number;
}

/** A leaf as a box relative to its hinge (the far stand-ins draw this). */
export interface DoorLeafBox {
  center: [number, number, number];
  size: [number, number, number];
  color: number;
}
