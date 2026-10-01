import { BRIDGE_CUT_FEATHER } from "./bridges/constants";
import { decksAround } from "./bridges/deckGround";
import { computeVertexData, riverKeepOff } from "./vertexCompute";
import type { GameObjectAttributes } from "../../objects/types";
import {
  densityCellRange,
  densityCellSize,
  densityProbability,
  passesPlacementFilters,
  rollDensityCell,
} from "./densityGrid";

/** The dressing `densityPoints` enumerator's params (objects/dressing/enumerators.ts). */
export interface DensityPointParams
  extends Pick<GameObjectAttributes, "biomeIds" | "heightRange" | "slopeRange" | "roadDistanceRange"> {
  /** Seed namespace — distinct from spawn-system descriptor ids. */
  seedTag: string;
  /** Instances per 1,000,000 sq units. */
  density: number;
  /** Min spacing between accepted points. */
  footprint: number;
}

/** Whether a point stands beside a deck: within its half width + BRIDGE_CUT_FEATHER of its path,
 *  abutments included — a landed end runs on over the road, where `underDeck` (the placement filter)
 *  is already 0 and a block's sidewalk can come within a few units of the slab's line. */
const besideDeck = (x: number, z: number): boolean => {
  for (const b of decksAround(x, z)) {
    const reach = b.width / 2 + BRIDGE_CUT_FEATHER;
    for (let i = 0; i + 1 < b.path.length; i++) {
      const a = b.path[i];
      const c = b.path[i + 1];
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < reach) return true;
    }
  }
  return false;
};

/** Half the central-difference baseline of the slope test — the foliage worker's height-grid step. */
const SLOPE_SAMPLE_STEP = 2;

/** Degrees, from central differences of the padded height (the surface the point stands on): the
 *  `slopeRange` test of every density placement that has one (here and the spawn worker). */
export const slopeDegreesAt = (x: number, z: number): number => {
  const dhdx = (computeVertexData(x + SLOPE_SAMPLE_STEP, z).height - computeVertexData(x - SLOPE_SAMPLE_STEP, z).height) / (2 * SLOPE_SAMPLE_STEP);
  const dhdz = (computeVertexData(x, z + SLOPE_SAMPLE_STEP).height - computeVertexData(x, z - SLOPE_SAMPLE_STEP).height) / (2 * SLOPE_SAMPLE_STEP);
  return (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
};

/**
 * STATELESS density placement: the spawn-worker scheme with greedy spacing over
 * a footprint-padded window instead of a cross-chunk hash, so a chunk yields the
 * same points in any visit order. Shared with the server's obstacle colliders
 * (physics/obstacles.ts) so its lamp posts stand exactly where the client draws
 * them. Spacing chains cut at the window edge can rarely leave a cross-border
 * pair slightly tighter than `footprint` — irrelevant for dressing.
 */
export const generateDensityPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  params: DensityPointParams
): { x: number; y: number; z: number }[] => {
  const cellSize = densityCellSize(params.density);
  const pad = params.footprint + cellSize;
  const [gx0, gx1] = densityCellRange(minX - pad, maxX + pad, cellSize);
  const [gz0, gz1] = densityCellRange(minZ - pad, maxZ + pad, cellSize);
  const probability = densityProbability(params.density, cellSize);
  const footprintSq = params.footprint * params.footprint;
  const slopeRange = params.slopeRange;

  const accepted: { x: number; z: number; y: number }[] = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const roll = rollDensityCell(params.seedTag, gx, gz, cellSize, probability);
      if (!roll) continue;
      const { x, z } = roll;

      const vd = computeVertexData(x, z);
      if (!passesPlacementFilters(vd, params, riverKeepOff()) || besideDeck(x, z)) continue;
      if (slopeRange) {
        const slope = slopeDegreesAt(x, z);
        if (slope < slopeRange[0] || slope > slopeRange[1]) continue;
      }

      let blocked = false;
      for (let i = accepted.length - 1; i >= 0; i--) {
        const a = accepted[i];
        const dx = x - a.x;
        const dz = z - a.z;
        if (dx * dx + dz * dz < footprintSq) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      accepted.push({ x, z, y: vd.height });
    }
  }

  // Padded ring cells participated in spacing but belong to neighboring chunks.
  return accepted
    .filter((a) => a.x >= minX && a.x < maxX && a.z >= minZ && a.z < maxZ)
    .map((a) => ({ x: a.x, y: a.y, z: a.z }));
};
