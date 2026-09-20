/**
 * THE density-grid placement: cell → seeded roll → seeded jitter → filters. The
 * spawn worker, the flatten-pad engine and the dressing worker's DENSITY_POINTS
 * must agree to the BIT (pads under buildings), so there is exactly one copy;
 * each caller keeps only its own spacing rule. Worker-safe: no THREE, no DOM.
 */

import { seedRand } from "../math/_math";
import type { GameObjectAttributes } from "../../objects/types";
import type { VertexResult } from "./vertexCompute";

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

export interface DensityCandidate {
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

/** Slope is not in VertexResult — the spawn and foliage workers evaluate slopeRange themselves. */
export const passesPlacementFilters = (
  vd: Pick<VertexResult, "biomeId" | "height" | "distanceToRoadCenter">,
  f: Pick<GameObjectAttributes, "biomeIds" | "heightRange" | "roadDistanceRange">,
): boolean => {
  if (f.biomeIds && f.biomeIds.length > 0 && !f.biomeIds.includes(vd.biomeId)) return false;
  if (f.heightRange && (vd.height < f.heightRange[0] || vd.height > f.heightRange[1])) return false;
  if (
    f.roadDistanceRange &&
    (vd.distanceToRoadCenter < f.roadDistanceRange[0] || vd.distanceToRoadCenter > f.roadDistanceRange[1])
  )
    return false;
  return true;
};

/** DENSITY_POINTS params — shared by dressingWorker.ts and the worker. */
export interface DensityPointParams extends Pick<GameObjectAttributes, "biomeIds" | "heightRange" | "roadDistanceRange"> {
  /** Seed namespace — distinct from spawn-system descriptor ids. */
  seedTag: string;
  /** Instances per 1,000,000 sq units. */
  density: number;
  /** Min spacing between accepted points. */
  footprint: number;
}
