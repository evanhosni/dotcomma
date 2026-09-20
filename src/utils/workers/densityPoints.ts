import { computeVertexData } from "./vertexCompute";
import {
  DensityPointParams,
  densityCellRange,
  densityCellSize,
  densityProbability,
  passesPlacementFilters,
  rollDensityCell,
} from "./densityPlacement";

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

  const accepted: { x: number; z: number; y: number }[] = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const roll = rollDensityCell(params.seedTag, gx, gz, cellSize, probability);
      if (!roll) continue;
      const { x, z } = roll;

      const vd = computeVertexData(x, z);
      if (!passesPlacementFilters(vd, params)) continue;

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
