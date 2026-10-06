/** A dressing chunk as the city's enumerators walk it: the district rows and segments it can touch,
 *  each district's cells over it (cache-first) and the city walls (the belt) around it. */

import { domainConfig } from "../computeConfig";
import { warp } from "../noise";
import type { Wall } from "../types";
import { getBiomeContext, cityWallsOf } from "../voronoi";
import { type CityCell, getCityCell, peekCityCell } from "./cityCells";
import { CITY_WIGGLE_AMP, type CityDistrict, cityLocalToWorld, findCityRow, findCitySeg } from "./cityDistricts";

export const cityCellAtLocal = (ix: number, iz: number, d: CityDistrict): CityCell => {
  // Cache-first: the walls/noise context costs 2 FBMs + a voronoi lookup, too much to pay on hits.
  const cached = peekCityCell(ix, iz, d);
  if (cached) return cached;

  const gs = domainConfig!.cityConfig.gridSize;
  const w = cityLocalToWorld((ix + 0.5) * gs, (iz + 0.5) * gs, d);
  return getCityCell(ix, iz, cityWallsOf(getBiomeContext(warp(w.x, w.z))), d);
};

/** The CITY walls (the belt) around a chunk: the biome context of its center. Belt candidates
 *  therefore depend on the query center's wall set — keep chunk size consistent. */
export const cityWallsAround = (minX: number, minZ: number, maxX: number, maxZ: number): Wall[] =>
  cityWallsOf(getBiomeContext(warp((minX + maxX) / 2, (minZ + maxZ) / 2)));

/** District-frame AABB of the chunk∩district overlap (padded by the wiggle amplitude); null when disjoint. */
export const cityChunkLocalAABB = (
  d: CityDistrict,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): { lminX: number; lmaxX: number; lminZ: number; lmaxZ: number } | null => {
  const wx0 = Math.max(minX, d.minX - CITY_WIGGLE_AMP);
  const wx1 = Math.min(maxX, d.maxX + CITY_WIGGLE_AMP);
  const wz0 = Math.max(minZ, d.minZ - CITY_WIGGLE_AMP);
  const wz1 = Math.min(maxZ, d.maxZ + CITY_WIGGLE_AMP);
  if (wx0 >= wx1 || wz0 >= wz1) return null;
  let lminX = Infinity;
  let lmaxX = -Infinity;
  let lminZ = Infinity;
  let lmaxZ = -Infinity;
  for (const [cxw, czw] of [
    [wx0, wz0],
    [wx0, wz1],
    [wx1, wz0],
    [wx1, wz1],
  ]) {
    const dx = cxw - d.px;
    const dz = czw - d.pz;
    const lcx = d.px + dx * d.cos + dz * d.sin;
    const lcz = d.pz - dx * d.sin + dz * d.cos;
    if (lcx < lminX) lminX = lcx;
    if (lcx > lmaxX) lmaxX = lcx;
    if (lcz < lminZ) lminZ = lcz;
    if (lcz > lmaxZ) lmaxZ = lcz;
  }
  return { lminX, lmaxX, lminZ, lmaxZ };
};

/** The district rows a chunk can touch, padded ±1 for the wiggle. */
export const chunkRowRange = (minZ: number, maxZ: number, midX: number): [number, number] => [findCityRow(minZ, midX) - 1, findCityRow(maxZ - 0.001, midX) + 1];
/** Row r's district segments a chunk can touch, padded ±1 for the wiggle. */
export const chunkSegRange = (r: number, minX: number, maxX: number, midZ: number): [number, number] => [findCitySeg(r, minX, midZ) - 1, findCitySeg(r, maxX - 0.001, midZ) + 1];
