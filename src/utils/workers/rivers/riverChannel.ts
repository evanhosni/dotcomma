/** A river's CHANNEL as step 4 carves it (computeVertexData), also what the bed-limit marches and the
 *  belt's outer half beside a river carve. */

import { smoothstep } from "../../math/_math";
import { domainConfig } from "../computeConfig";
import { SHORE_RISE } from "../lakes";
import type { RiverParams } from "../types";

/** How far out a river's water is reported (and the bank held above it), factor-1 units: past the
 *  waterline, so the water mesh's shore triangles are level and meet the rising bank. */
export const riverWaterBand = (river: RiverParams): number => river.halfWidth + river.bank * 0.5;

/** Step 4's channel at a vertex `distanceToRiver` (factor-1) from a river whose surface is
 *  `surface`: FORCED, not min'ed — a parabola from depth under the surface to a rim SHORE_RISE above
 *  it at the half-width (the water's edge sits just inside), the bank blending the rim back into the
 *  terrain, so it raises low ground as well as cutting high ground. Depth grows with the root of the
 *  width factor. */
export const carveRiverChannel = (height: number, distanceToRiver: number, surface: number, factor: number): number => {
  const river = domainConfig!.river;
  const riverReach = river.halfWidth + river.bank;
  const depth = river.depth * Math.sqrt(factor);
  const rim = surface + SHORE_RISE;
  // Ground LOWER than the rim is held at it across the whole water band and only then descends:
  // blended down from the half-width, the bank sits under the surface there and the water mesh draws
  // a second strip on the dry bank.
  return distanceToRiver < river.halfWidth
    ? rim - (depth + SHORE_RISE) * (1 - (distanceToRiver / river.halfWidth) ** 2)
    : rim + (height - rim) * smoothstep(height < rim ? riverWaterBand(river) : river.halfWidth, riverReach, distanceToRiver);
};
