/** A river's CHANNEL as step 4 carves it (computeVertexData), also what the bed-limit marches and the
 *  belt's outer half beside a river carve. */

import { smoothstep } from "../../math";
import { riverBankReliefOf } from "./bankParams";
import { ZONE_WEIGHT_EPS, zoneFinal, zones } from "../zoneBlend";
import { domainConfig } from "../computeConfig";
import { SHORE_RISE } from "../lakes";
import { terrainNoise } from "../noise";
import type { RiverParams } from "../types";

/** How far out a river's water is reported (and the bank held above it), factor-1 units: past the
 *  waterline, so the water mesh's shore triangles are level and meet the rising bank. */
export const riverWaterBand = (river: RiverParams): number => river.halfWidth + river.bank * 0.5;

/** The relief is the noise's smooth ABSOLUTE value (√(n² + k²) − k, k = this many units): the bank
 *  never dips under the rim into the water, both signs of the noise rise, and the fold leaves a
 *  rounded valley, not a crease. Folding the negative half away (a softplus) instead left every
 *  stretch where the noise runs negative flat at the rim — half the banks. */
const BANK_BUMP_SOFT = 1;
/** The relief comes in as the ground under the bank lies this far under the rim (a drop-off beside
 *  the river), fully at the second, and then GROWS with the drop: 1× at none, +1× per BANK_DROP_SCALE
 *  of drop up to BANK_DROP_CAP (a terrace beside a 40u cliff, seen from the next ridge, wore 2u lumps
 *  as flat; it takes mountain-sized ones). */
const BANK_DROP_START = 2;
const BANK_DROP_FULL = 12;
const BANK_DROP_SCALE = 25;
const BANK_DROP_CAP = 50;

/** The BIOME's noise at a bank, as relief (≥ 0): its `detail` layers where it has them (the mountain's
 *  bulges and bumps, never its dome), else its own height noise, plus the same noise finer, scaled by the
 *  biome's `riverBankRelief` params as a smooth absolute value. Zero for a biome without the flag (a
 *  smooth bank: the desert's dunes read as spikes along a river, Evan) or without noise (the city).
 *  Evan: "if the river bank has a steep dropoff right to the side, then that bank should add the noise
 *  of the biome its in" — a levee held flat at the rim read as a dam (his screenshots). Lifting the noise
 *  off its theoretical floor instead gave a near-constant 5u (the perlin sum hugs its mean): no bumps. */
const riverBankBump = (biomeId: number, x: number, z: number): number => {
  const params = riverBankReliefOf(biomeId);
  const config = domainConfig!.biomeNoiseConfigs[biomeId];
  if (!params || !config) return 0;
  const layers = config.detail && config.detail.length > 0 ? config.detail : [config.params];
  let relief = 0;
  for (const layer of layers) {
    relief += terrainNoise(layer, x, z);
    relief += params.fineShare * terrainNoise(layer, x * params.fineScale, z * params.fineScale);
  }
  relief *= params.share;
  return Math.sqrt(relief * relief + BANK_BUMP_SOFT * BANK_BUMP_SOFT) - BANK_BUMP_SOFT;
};

/** A biome's relief is whole from this zone weight up and fades to none at 0. By the plain weight, only
 *  22% of the mountain's own bank points (a river scan over 9000×8000u) had full relief and 36% under
 *  half — the mountain's 220u feather spans most of where rivers reach it — and its banks read flat
 *  again (Evan's screenshot). From a quarter, the fade lies mostly past the wall, in the neighbor. */
const BANK_RELIEF_FULL_WEIGHT = 0.25;

/** The bank relief at a point, blended across the zones in reach by the CURRENT zone weights (call it
 *  right after the point's combineZoneWeights), each flagged biome's share rising to whole by
 *  BANK_RELIEF_FULL_WEIGHT: a bank crossing a biome wall fades from one biome's relief into the other's,
 *  or into a smooth bank. Read off the own biome alone, it stepped at every wall a river ran through
 *  (seams.test.ts measured 37u, blend.test.ts 1u across a junction). */
export const blendedRiverBankBump = (x: number, z: number): number => {
  let bump = 0;
  let share = 0;
  for (let i = 0; i < zones.length; i++) {
    const w = zoneFinal[i];
    if (w < ZONE_WEIGHT_EPS || !riverBankReliefOf(zones[i].biome.id)) continue;
    const s = smoothstep(0, BANK_RELIEF_FULL_WEIGHT, w);
    bump += s * riverBankBump(zones[i].biome.id, x, z);
    share += s;
  }
  // Two flagged biomes both past BANK_RELIEF_FULL_WEIGHT share the relief instead of adding up.
  return share > 1 ? bump / share : bump;
};

/** Step 4's channel at a vertex `distanceToRiver` (factor-1) from a river whose surface is
 *  `surface`: FORCED, not min'ed — a parabola from depth under the surface to a rim SHORE_RISE above
 *  it at the half-width (the water's edge sits just inside), the bank blending the rim back into the
 *  terrain, so it raises low ground as well as cutting high ground. Depth grows with the root of the
 *  width factor. `bump` (riverBankBump) is the biome's relief the rim takes where the ground lies
 *  under it by a drop-off: a levee's bank is bumpy, a cut bank is the terrain's own. */
export const carveRiverChannel = (height: number, distanceToRiver: number, surface: number, factor: number, bump = 0): number => {
  const river = domainConfig!.river;
  const riverReach = river.halfWidth + river.bank;
  const depth = river.depth * Math.sqrt(factor);
  const drop = surface + SHORE_RISE - height;
  const lift = bump * smoothstep(BANK_DROP_START, BANK_DROP_FULL, drop) * (1 + Math.min(Math.max(drop, 0), BANK_DROP_CAP) / BANK_DROP_SCALE);
  const rim = surface + SHORE_RISE + lift;
  // Ground LOWER than the rim is held at it across the whole water band and only then descends:
  // blended down from the half-width, the bank sits under the surface there and the water mesh draws
  // a second strip on the dry bank.
  return distanceToRiver < river.halfWidth
    ? rim - (depth + SHORE_RISE + lift) * (1 - (distanceToRiver / river.halfWidth) ** 2)
    : rim + (height - rim) * smoothstep(height < rim ? riverWaterBand(river) : river.halfWidth, riverReach, distanceToRiver);
};
