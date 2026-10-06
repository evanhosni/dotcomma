/**
 * TRAFFIC SIGNALS at the city's signalized street intersections (tests: cityFeatures.test.ts).
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { seedRand } from "../../math/_math";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../rivers/constants";
import { computeVertexData } from "../vertexCompute";
import { CITY_SHAPE_CIRCLE } from "./cityCells";
import { cityCellAtLocal, cityChunkLocalAABB, chunkRowRange, chunkSegRange } from "./cityChunks";
import { cityArterialDist, cityDistrictByIndex, cityLocalToWorld, getCityDistrict } from "./cityDistricts";

export interface CityTrafficLightPoint {
  x: number;
  y: number; // terrain height at the pole base (sidewalk corner)
  z: number;
  dirX: number; // unit direction the signal head faces (toward the intersection)
  dirZ: number;
  phase: number; // seeded [0,1) — desynchronizes the per-light signal cycles
}

/** Seeded roll per intersection (a grid corner where ≥3 road arms meet); one
 *  pole per block corner, marched diagonally out until the road field says
 *  sidewalk. Ownership by the CORNER's world position keeps chunked calls
 *  duplicate-free even when an intersection straddles a border. */
export function getCityTrafficLightPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chance: number
): CityTrafficLightPoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const gs = city.gridSize;
  const out: CityTrafficLightPoint[] = [];

  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const [rows0, rows1] = chunkRowRange(minZ, maxZ, midX);
  for (let r = rows0; r <= rows1; r++) {
    const [m0, m1] = chunkSegRange(r, minX, maxX, midZ);
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);
      const aabb = cityChunkLocalAABB(d, minX, minZ, maxX, maxZ);
      if (!aabb) continue;

      const ix0 = Math.floor(aabb.lminX / gs) - 1;
      const ix1 = Math.floor(aabb.lmaxX / gs) + 2;
      const iz0 = Math.floor(aabb.lminZ / gs) - 1;
      const iz1 = Math.floor(aabb.lmaxZ / gs) + 2;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          // Corner at local (ix·gs, iz·gs); the four cells around it.
          const A = cityCellAtLocal(ix - 1, iz - 1, d);
          const B = cityCellAtLocal(ix, iz - 1, d);
          const C = cityCellAtLocal(ix - 1, iz, d);
          const D = cityCellAtLocal(ix, iz, d);
          // Roundabout territory never gets signals.
          if (
            A.shape === CITY_SHAPE_CIRCLE ||
            B.shape === CITY_SHAPE_CIRCLE ||
            C.shape === CITY_SHAPE_CIRCLE ||
            D.shape === CITY_SHAPE_CIRCLE
          )
            continue;
          const arms =
            (A.label !== B.label ? 1 : 0) + // south arm
            (C.label !== D.label ? 1 : 0) + // north arm
            (A.label !== C.label ? 1 : 0) + // west arm
            (B.label !== D.label ? 1 : 0); // east arm
          if (arms < 3) continue;
          if (seedRand(`${city.seed}-tl-${d.key}|${ix},${iz}`) >= chance) continue;

          const pc = cityLocalToWorld(ix * gs, iz * gs, d);
          if (pc.x < minX || pc.x >= maxX || pc.z < minZ || pc.z >= maxZ) continue;
          if (getCityDistrict(pc.x, pc.z).key !== d.key) continue; // wiggly district clip
          // The arterial chamfer eats these corners.
          if (cityArterialDist(pc.x, pc.z, d) < city.freewayWidth + 16) continue;

          const lx = ix * gs;
          const lz = iz * gs;
          for (const [sx, sz] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]) {
            // The chamfer cuts corners at varying depths, so march until the field says sidewalk.
            for (let off = 16; off <= 26; off += 2) {
              const p = cityLocalToWorld(
                lx + sx * off * Math.SQRT1_2,
                lz + sz * off * Math.SQRT1_2,
                d
              );
              const vd = computeVertexData(p.x, p.z);
              if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) break;
              // Strictly inside the belt ring, one-sided (see the road markers).
              if (vd.distanceToBiomeBoundaryCenter < city.freewayWidth + 5)
                break;
              if (vd.distanceToRoadCenter < 8.4) continue; // still on road/curb
              if (vd.distanceToRoadCenter > 11.6) break; // past the sidewalk — no footing
              const fx = -sx * Math.SQRT1_2;
              const fz = -sz * Math.SQRT1_2;
              out.push({
                x: p.x,
                y: vd.height,
                z: p.z,
                dirX: fx * d.cos - fz * d.sin,
                dirZ: fx * d.sin + fz * d.cos,
                phase: seedRand(`${city.seed}-tlph-${d.key}|${ix},${iz}|${sx},${sz}`),
              });
              break;
            }
          }
        }
      }
    }
  }

  return out;
}
