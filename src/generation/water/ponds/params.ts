/** The <Pond> body: its kinds, its params and its biome accessors. Three-free. */

import { biomeById } from "../../registry";
import { domainConfig } from "../../store";
import { WALL_DEFAULTS } from "../channel/params";
import { POND_KIND } from "../params";
import type { WallShape, WaterColorProps, WaterColors } from "../types";

export { POND_KIND } from "../params";

/** One KIND of pond (a pond, a spring): Three-free data, like an ActorSpec. */
export interface PondSpec extends WaterColorProps {
  /** Its name, and its seed namespace. */
  id: string;
  /** The waterline radius range (real units), seeded per pond. */
  radius: [number, number];
  /** × the river depth at the centre. */
  depth: number;
  /** The waterline wobble: `amount` of the radius, `lobes` around (0 = round). */
  blob: { amount: number; lobes: number };
  /** A standalone spot whose ground spreads more than this × its radius is too steep (default
   *  POND_MAX_SPREAD). */
  maxSpread?: number;
}

/** A standalone pond's spot whose ground spreads more than this × its radius over its waterline is too
 *  steep. At the design's 0.5 (with the level at the centre) a pond on a 30u slope stood on a terrace of
 *  held rim with a cliff below it; 0.25 kept a third of the grass ponds (grass is bumpy at a pond's scale). */
export const POND_MAX_SPREAD = 0.35;

/** What a <Pond> mount (or <Water defaults={{ pond }}>, for every mount) may set beyond its kind and
 *  chances: the walls its channel cuts, and how its ponds sit on a river. */
export interface PondShape extends WallShape {
  /** On a river its pond is at least this × the river's half-width in radius (narrower, it would not show
   *  past the channel; 1.4 until Nov 2026, too small to read). */
  minRadiusOverRiver: number;
  /** A MID-RIVER pond stands only on a stretch no steeper than this (rise per unit). */
  calmGrade: number;
  /** A river climbing to a SUMMIT pond narrows to this × its width at the pond's waterline. */
  summitStream: number;
}
export const POND_DEFAULTS: PondShape = { ...WALL_DEFAULTS, minRadiusOverRiver: 2.1, calmGrade: 0.05, summitStream: 0.5 };

/** A <Pond> as its body carries it: the kind (the mount's shape overrides applied), each mode's chance per
 *  opportunity (0–1), its shape, and its water's colours (the mount's, else its kind's). */
interface PondParams extends PondShape, Record<PondMode, number>, Partial<WaterColors> {
  kind: PondSpec;
}

/** A pond as one biome carries it: its body's params and slot. */
export interface PondMount extends PondParams {
  body: number;
}
/** A placement mode (world/water/README.md "Ponds"), each a chance per opportunity: a river's natural END,
 *  a calm slot MID-RIVER, the SUMMIT of a gap a climb reaches, a STANDALONE grid cell. */
export type PondMode = "riverEnd" | "midRiver" | "summit" | "standalone";
export const POND_MODES: readonly PondMode[] = ["riverEnd", "midRiver", "summit", "standalone"];

/** The <Pond> mounts a biome carries (its own and its region's), in JSX order. */
export const pondsOf = (biomeId: number): PondMount[] => {
  const out: PondMount[] = [];
  for (const slot of biomeById(biomeId)?.waterBodies ?? []) {
    const body = domainConfig!.waterBodies[slot];
    if (body.kind === POND_KIND) out.push({ ...(body.params as PondParams), body: slot });
  }
  return out;
};
