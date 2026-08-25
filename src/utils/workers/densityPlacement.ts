/**
 * Density-grid placement — the ONE implementation of "density cell → seeded
 * roll → seeded jitter → placement filters".
 *
 * Three systems place objects on this scheme and MUST agree to the bit: the
 * spawn worker (actors), the flatten-pad engine inside the height function
 * (which replays a flattenGround actor's candidates so every instance sits on
 * a pad) and the dressing worker's stateless density placement (street
 * lamps). They used to be three hand-kept copies of the same seeds and
 * filters; a divergence would have desynced pads from buildings without any
 * error. Each caller keeps only its own spacing rule (stateful hash / greedy
 * / Matérn rounds).
 *
 * Worker-safe: no THREE, no DOM.
 */

import { seedRand } from "../math/_math";
import type { PlacementFilters } from "../../objects/types";
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

/**
 * Roll one density cell. Returns the jittered candidate position, or null when
 * the cell rolls empty (probability or clustering gate). Seeds are
 * `${id}_${gx}_${gz}` (+ "_x"/"_z" for the jitter, `cluster_` prefix for the
 * gate) — the exact strings every consumer has always used, so worlds are
 * unchanged.
 */
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

/** The shared placement filters (objects/types.ts PlacementFilters) against a
 *  computed vertex. Slope is not part of the vertex result — the spawn worker
 *  and foliage worker evaluate slopeRange themselves. */
export const passesPlacementFilters = (
  vd: Pick<VertexResult, "biomeId" | "height" | "distanceToRoadCenter">,
  f: Pick<PlacementFilters, "biomeIds" | "heightRange" | "roadDistanceRange">,
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

/** Parameters of the dressing worker's stateless density placement
 *  (DENSITY_POINTS) — shared by the client (dressingWorker.ts) and the worker. */
export interface DensityPointParams extends Pick<PlacementFilters, "biomeIds" | "heightRange" | "roadDistanceRange"> {
  /** Seed namespace — distinct from spawn-system descriptor ids. */
  seedTag: string;
  /** Instances per 1,000,000 sq units. */
  density: number;
  /** Min spacing between accepted points. */
  footprint: number;
}
