/**
 * City DISTRICTS (CLAUDE.md "City terrain"): jittered rows ~districtSize cells tall, split into
 * staggered jittered segments. Each rotates its whole block grid by a seeded multiple of 15° about its
 * center; district boundaries carry the wiggly ARTERIAL roads, which hide the grid seams. Leaf module:
 * imports nothing from the pipeline but the live config.
 */

import { seedRand } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";

const CITY_DISTRICT_JITTER = 0.4; // boundary jitter (× pitch): sizes ~0.6–1.4 × districtSize

export const cityDistrictPitch = (): number => domainConfig!.cityConfig.districtSize * domainConfig!.cityConfig.gridSize;

// Hottest scalar lookups (the find* loops probe them ≥4× per vertex): numeric keys so hits allocate nothing.
const cityRowBoundaryCache = new Map<number, number>();
/** Z of the boundary line between district rows k−1 and k. */
export const cityRowBoundary = (k: number): number => {
  let v = cityRowBoundaryCache.get(k);
  if (v === undefined) {
    const pitch = cityDistrictPitch();
    v = (k + (seedRand(`${domainConfig!.cityConfig.seed}-drow-${k}`) - 0.5) * CITY_DISTRICT_JITTER) * pitch;
    if (cityRowBoundaryCache.size > 4096) dropOldestHalf(cityRowBoundaryCache);
    cityRowBoundaryCache.set(k, v);
  }
  return v;
};

const citySegBoundaryCache = new Map<number, Map<number, number>>();
/** X of the boundary line between segments m−1 and m of row r (staggered
 *  per row via a seeded phase). */
export const citySegBoundary = (r: number, m: number): number => {
  let row = citySegBoundaryCache.get(r);
  if (!row) {
    if (citySegBoundaryCache.size > 1024) dropOldestHalf(citySegBoundaryCache);
    row = new Map();
    citySegBoundaryCache.set(r, row);
  }
  let v = row.get(m);
  if (v === undefined) {
    const pitch = cityDistrictPitch();
    const phase = seedRand(`${domainConfig!.cityConfig.seed}-dphase-${r}`);
    v =
      (m + phase + (seedRand(`${domainConfig!.cityConfig.seed}-dseg-${r}-${m}`) - 0.5) * CITY_DISTRICT_JITTER) *
      pitch;
    row.set(m, v);
  }
  return v;
};

// Arterials bend with two seeded sine octaves. District ASSIGNMENT follows the
// same curve so the rotated-grid switch always stays under the road surface.
export const CITY_WIGGLE_AMP = 38;
const CITY_WIGGLE_K1 = (2 * Math.PI) / 620;
const CITY_WIGGLE_K2 = (2 * Math.PI) / 260;

/** An arterial's two seeded wiggle phases, cached by the arterial's NUMERIC identity: the find*
 *  loops probe the curves ≥4× per city vertex (tag strings per probe were ~7% of a city chunk). */
const cityWigglePhases = (tag: string): Float64Array => {
  const seed = domainConfig!.cityConfig.seed;
  return Float64Array.of(seedRand(`${seed}-wig1-${tag}`) * Math.PI * 2, seedRand(`${seed}-wig2-${tag}`) * Math.PI * 2);
};
const rowWiggleCache = new Map<number, Float64Array>();
const segWiggleCache = new Map<number, Map<number, Float64Array>>();
export const rowWiggle = (k: number): Float64Array => {
  let p = rowWiggleCache.get(k);
  if (!p) {
    if (rowWiggleCache.size > 4096) dropOldestHalf(rowWiggleCache);
    rowWiggleCache.set(k, (p = cityWigglePhases(`r${k}`)));
  }
  return p;
};
export const segWiggle = (r: number, m: number): Float64Array => {
  let row = segWiggleCache.get(r);
  if (!row) {
    if (segWiggleCache.size > 1024) dropOldestHalf(segWiggleCache);
    segWiggleCache.set(r, (row = new Map()));
  }
  let p = row.get(m);
  if (!p) row.set(m, (p = cityWigglePhases(`s${r}:${m}`)));
  return p;
};

const cityWiggle = (phases: Float64Array, t: number): number =>
  CITY_WIGGLE_AMP * (0.65 * Math.sin(t * CITY_WIGGLE_K1 + phases[0]) + 0.35 * Math.sin(t * CITY_WIGGLE_K2 + phases[1]));

/** d(wiggle)/dt — the arterial tangent slope (for marker orientation). */
export const cityWiggleSlope = (phases: Float64Array, t: number): number =>
  CITY_WIGGLE_AMP *
  (0.65 * CITY_WIGGLE_K1 * Math.cos(t * CITY_WIGGLE_K1 + phases[0]) + 0.35 * CITY_WIGGLE_K2 * Math.cos(t * CITY_WIGGLE_K2 + phases[1]));

/** Z of the (wiggly) arterial centerline between rows k−1 and k, at world x. */
export const cityRowEdgeZ = (k: number, vx: number): number => cityRowBoundary(k) + cityWiggle(rowWiggle(k), vx);

/** X of the (wiggly) arterial centerline between segments m−1 and m of row r, at world z. */
export const citySegEdgeX = (r: number, m: number, vz: number): number => citySegBoundary(r, m) + cityWiggle(segWiggle(r, m), vz);

export const findCityRow = (vz: number, vx: number): number => {
  let r = Math.floor(vz / cityDistrictPitch());
  while (vz < cityRowEdgeZ(r, vx)) r -= 1;
  while (vz >= cityRowEdgeZ(r + 1, vx)) r += 1;
  return r;
};

export const findCitySeg = (r: number, vx: number, vz: number): number => {
  let m = Math.floor(vx / cityDistrictPitch() - 0.5);
  while (vx < citySegEdgeX(r, m, vz)) m -= 1;
  while (vx >= citySegEdgeX(r, m + 1, vz)) m += 1;
  return m;
};

export interface CityDistrict {
  key: string;
  r: number; // row / segment indices (for the wiggly edge lookups)
  m: number;
  cos: number; // rotation: a seeded multiple of 15°
  sin: number;
  px: number; // rotation pivot (district center, world)
  pz: number;
  minX: number; // district rect BASELINE (world; actual edges wiggle ±CITY_WIGGLE_AMP)
  maxX: number;
  minZ: number;
  maxZ: number;
}

const cityDistrictCache = new Map<string, CityDistrict>();
export const cityDistrictByIndex = (r: number, m: number): CityDistrict => {
  const key = `${r},${m}`;
  let d = cityDistrictCache.get(key);
  if (d === undefined) {
    if (cityDistrictCache.size > 1024) dropOldestHalf(cityDistrictCache);
    const minZ = cityRowBoundary(r);
    const maxZ = cityRowBoundary(r + 1);
    const minX = citySegBoundary(r, m);
    const maxX = citySegBoundary(r, m + 1);
    // 15°..75° in 15° steps — 0° is deliberately excluded so EVERY district
    // reads as rotated against its arterial frame.
    const angle =
      (1 + Math.floor(seedRand(`${domainConfig!.cityConfig.seed}-dang-${key}`) * 5)) * (Math.PI / 12);
    d = {
      key,
      r,
      m,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      px: (minX + maxX) / 2,
      pz: (minZ + maxZ) / 2,
      minX,
      maxX,
      minZ,
      maxZ,
    };
    cityDistrictCache.set(key, d);
  }
  return d;
};

export const getCityDistrict = (vx: number, vz: number): CityDistrict => {
  const r = findCityRow(vz, vx);
  return cityDistrictByIndex(r, findCitySeg(r, vx, vz));
};

/** Axis-approximate distance to the district's wiggly arterial centerlines. */
export const cityArterialDist = (vx: number, vz: number, d: CityDistrict): number =>
  Math.max(
    0,
    Math.min(
      vz - cityRowEdgeZ(d.r, vx),
      cityRowEdgeZ(d.r + 1, vx) - vz,
      vx - citySegEdgeX(d.r, d.m, vz),
      citySegEdgeX(d.r, d.m + 1, vz) - vx
    )
  );

/** District-local → world (rotate by +angle about the district pivot). */
export const cityLocalToWorld = (lx: number, lz: number, d: CityDistrict): PointXZ => {
  const dx = lx - d.px;
  const dz = lz - d.pz;
  return { x: d.px + dx * d.cos - dz * d.sin, z: d.pz + dx * d.sin + dz * d.cos };
};

export const clearCityDistrictCaches = (): void => {
  rowWiggleCache.clear();
  segWiggleCache.clear();
  cityRowBoundaryCache.clear();
  citySegBoundaryCache.clear();
  cityDistrictCache.clear();
};
