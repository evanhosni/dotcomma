import type { LiquidKind, SurfaceKind, SurfaceMovement } from "./types";

/** What every kind of ground does to a capsule's step, as multipliers: `speed` × the walk, `slope` ×
 *  every slope limit (the uphill fade's start and end and the slide angle). Ground not listed is 1 and 1.
 *  A liquid applies from the feet under its surface, wading or swimming. */
export const SURFACE_MOVEMENT: Record<SurfaceKind, SurfaceMovement> = {
  /** Packs under the feet: the slide angle 40° → 52°. */
  snow: { speed: 0.6, slope: 1.3 },
  water: { speed: 0.5, slope: 1 },
  sewage: { speed: 0.25, slope: 1 },
};

/** A liquid's thickness relative to water: divides a swim's vertical speeds and accelerations and
 *  multiplies its drag (the walk is SURFACE_MOVEMENT's). */
export const LIQUID_VISCOSITY: Record<LiquidKind, number> = {
  water: 1,
  sewage: 2.5,
};

/** The ground probe stops reading ground as ground past ~60°: no slope factor raises the slide angle past this. */
export const MAX_SLIDE_ANGLE = (55 * Math.PI) / 180;
