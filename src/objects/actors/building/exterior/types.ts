import { RingLevel } from "../types";

// ─── Exterior: lofted masses, roof caps, pipes ──────────────────────────────

/** A shell cross-section at height y, scaled by rScale. Rings up to interiorTop are clamped to wrap the
 *  interior prism; above it the shell leans/tapers freely. */
export type ShellRingAt = ((y: number, rScale: number) => RingLevel) & {
  interiorTop: number;
  /** Clearance a ring leaning by `lean` keeps around the interior. */
  clampMargin: (lean: number) => number;
};

export interface SegmentBounds {
  loft: number;
  y0: number;
  y1: number;
}
