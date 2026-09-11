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
 * STATELESS density-grid placement (spawn-system style): the same
 * density-cell + seeded-jitter + probability-roll scheme as spawn.worker.ts,
 * made fully DETERMINISTIC per query — spacing is a greedy pass in global cell
 * order over a footprint-padded window instead of a stateful cross-chunk hash,
 * so a chunk always produces the same points no matter the visit order. Used
 * for mass static dressing (street lamps) that renders instanced instead of as
 * per-object spawn components, by the dressing worker on the client AND by the
 * server's obstacle colliders (physics/obstacles.ts) — one function, so the
 * server's lamp posts stand exactly where the client draws them. Ownership is
 * by candidate position, so chunked calls never emit duplicates; spacing
 * chains cut at the window edge can, rarely, leave a cross-border pair
 * slightly tighter than `footprint` — cosmetically irrelevant for dressing.
 */
export const generateDensityPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  p: DensityPointParams
): { x: number; y: number; z: number }[] => {
  const cellSize = densityCellSize(p.density);
  const pad = p.footprint + cellSize;
  const [gx0, gx1] = densityCellRange(minX - pad, maxX + pad, cellSize);
  const [gz0, gz1] = densityCellRange(minZ - pad, maxZ + pad, cellSize);
  const probability = densityProbability(p.density, cellSize);
  const footprintSq = p.footprint * p.footprint;

  const accepted: { x: number; z: number; y: number }[] = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const roll = rollDensityCell(p.seedTag, gx, gz, cellSize, probability);
      if (!roll) continue;
      const { x, z } = roll;

      const vd = computeVertexData(x, z);
      if (!passesPlacementFilters(vd, p)) continue;

      // Greedy spacing in global (gx, gz) order — deterministic, no state.
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

  // Ownership: emit only points inside the queried bounds (padded ring cells
  // participated in spacing but belong to neighboring chunks).
  return accepted
    .filter((a) => a.x >= minX && a.x < maxX && a.z >= minZ && a.z < maxZ)
    .map((a) => ({ x: a.x, y: a.y, z: a.z }));
};
