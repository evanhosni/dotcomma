/** Something interactive under the crosshair (an actor, a door, a manhole). Held by claimHover while it is
 *  hovered; the object itself is the claim's key, so keep one per owner and update `distance` in place. */
export interface HoverTarget {
  /** Eye → hit: the NEAREST claim gets the mouse. */
  distance: number;
  /** Grows the crosshair while held. */
  growsCursor: boolean;
  /** Every mouse event while it is the nearest claim: click, contextmenu, pointerdown/up, dblclick, wheel. */
  onMouse: (e: MouseEvent) => void;
}

/** The beeble's crosshair dot, the MAV Unit's bracket reticle, or nothing. */
export type CursorLook = "dot" | "reticle" | "none";
