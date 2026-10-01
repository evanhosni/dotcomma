/**
 * THE density-grid placement: cell → seeded roll → seeded jitter → filters. The
 * spawn worker, the flatten-pad engine and the dressing `densityPoints` enumerator
 * must agree to the BIT (pads under buildings), so there is exactly one copy;
 * each caller keeps only its own spacing rule. Worker-safe: no THREE, no DOM.
 */

import { seedRand } from "../math/_math";
import type { GameObjectAttributes } from "../../objects/types";
import type { VertexResult } from "./types";

/** Density cell edge for `density` instances per 1,000,000 sq units. */
export const densityCellSize = (density: number): number => Math.sqrt(1_000_000 / density);

/** Probability a cell places (≤ 1: the cell area × density). */
export const densityProbability = (density: number, cellSize: number): number =>
  (density * cellSize * cellSize) / 1_000_000;

/** Inclusive cell index range covering [min, max]. */
export const densityCellRange = (min: number, max: number, cellSize: number): [number, number] => [
  Math.floor(min / cellSize),
  Math.floor(max / cellSize),
];

interface DensityCandidate {
  x: number;
  z: number;
}

/** Seeds are `${id}_${gx}_${gz}` (+ "_x"/"_z" jitter, `cluster_` gate) — the strings every consumer has always used. */
export const rollDensityCell = (
  id: string,
  gx: number,
  gz: number,
  cellSize: number,
  probability: number,
  clustering = 0,
): DensityCandidate | null => {
  const seed = `${id}_${gx}_${gz}`;
  if (seedRand(seed) > probability) return null;
  if (clustering > 0 && seedRand(`cluster_${id}_${gx}_${gz}`) < clustering * 0.7) return null;
  return {
    x: gx * cellSize + seedRand(seed + "_x") * cellSize,
    z: gz * cellSize + seedRand(seed + "_z") * cellSize,
  };
};

/** Slope is not in VertexResult — a caller with a `slopeRange` tests it itself (slopeDegreesAt in
 *  densityPoints.ts, which the spawn worker calls too; the foliage worker reads its height grid). The
 *  flatten-pad engine does not: a `flattenGround` actor's slopeRange is not applied.
 *  `riverKeepOff`: nothing is placed within this many factor-1 river units of a river centerline —
 *  the channel and its banks, whatever the road field says there (the quay's river-side field sits
 *  inside the lamp band). Nothing stands on or beside a bridge deck either (`underDeck`: its
 *  footprint + the cut's feather), where a landed end's road field would admit lamps. The flatten-pad
 *  engine evaluates RAW (no decks), so pads never see it — buildings' road band (≥ 23) never meets a
 *  deck anyway. */
export const passesPlacementFilters = (
  vd: Pick<VertexResult, "biomeId" | "height" | "distanceToRoadCenter" | "distanceToRiverCenter" | "underDeck">,
  f: Pick<GameObjectAttributes, "biomeIds" | "heightRange" | "roadDistanceRange">,
  riverKeepOff: number,
): boolean => {
  if (vd.distanceToRiverCenter < riverKeepOff || vd.underDeck > 0) return false;
  if (f.biomeIds && f.biomeIds.length > 0 && !f.biomeIds.includes(vd.biomeId)) return false;
  if (f.heightRange && (vd.height < f.heightRange[0] || vd.height > f.heightRange[1])) return false;
  if (
    f.roadDistanceRange &&
    (vd.distanceToRoadCenter < f.roadDistanceRange[0] || vd.distanceToRoadCenter > f.roadDistanceRange[1])
  )
    return false;
  return true;
};
