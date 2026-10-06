/**
 * City BLOCK CELLS (CLAUDE.md "City terrain"): each district's square block grid, its 2×2 shape
 * features (triangles, roundabouts) and the REMNANT rule — a cell the city's edge roads (belt,
 * arterials, quays) leave too little of joins a neighbor's block. getCityCell caches by first query.
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { seedRand } from "../../math/_math";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { warp, warpMax } from "../noise";
import { riverWetReach } from "../rivers/constants";
import { riverPiecesNear, riversEnabled } from "../rivers/riverNetwork";
import type { Wall } from "../types";
import { distanceToWall } from "../voronoi";
import { type CityDistrict, cityArterialDist, cityLocalToWorld } from "./cityDistricts";
import { CITY_ARTERIAL_RECOVER_NORM, CITY_BELT_RECOVER_NORM, freewayField } from "./cityRoadField";

// Every road feature is CONFINED to its own cell — that is what guarantees no tiny leftover pieces.
const CITY_SHAPE_SQUARE = 0;
export const CITY_SHAPE_TRI_NE = 1; // diagonal road from the SW corner to the NE corner
export const CITY_SHAPE_TRI_NW = 2; // diagonal road from the NW corner to the SE corner
export const CITY_SHAPE_CIRCLE = 3; // circular block inside a roundabout ring road

// Roundabout ring-road centerline radius (× gridSize), centered on its 2×2
// super-cell: frac + roadWidth/gs must stay < 1.
export const CITY_RING_RADIUS_FRAC = 0.825;

export interface CityCell {
  /** Block index in [0, blockCount) for squares (same labels merge; a REMNANT carries a neighbor's, or
   *  CITY_REMNANT_LABEL); a unique id (≥1000) for triangle/circle cells so roads always ring them. */
  label: number;
  shape: number;
  /** Whether an edge road reaches into the cell (not every sample of it is land). */
  edged: boolean;
}

/** A collision between adjacent special cells would only merge their boundary road — harmless. */
export const cityUniqueLabel = (ix: number, iz: number): number =>
  1000 + ((((ix * 73856093) ^ (iz * 19349663)) >>> 0) % 1000000);

const superCellHasRoom = (sx: number, sz: number, walls: Wall[], d: CityDistrict): boolean => {
  const city = domainConfig!.cityConfig;
  const gs = city.gridSize;
  const w = cityLocalToWorld((2 * sx + 1) * gs, (2 * sz + 1) * gs, d);
  if (distanceToWall(w.x, w.z, walls) < gs * 1.6) return false;
  // Rotated super-cell extent (√2·gs) + the arterial road.
  return cityArterialDist(w.x, w.z, d) >= gs * 1.7;
};

// ── Remnants: cells the city's EDGE roads (belt, arterials, quays) leave too little of ──

/** Samples per axis across a cell; the middle CITY_CORE_SAMPLES² (centers ≥ a building's setback
 *  from the cell's border) are its CORE. */
const CITY_CELL_SAMPLES = 9;
const CITY_CORE_SAMPLES = 5;
/** The road field past the sidewalk band (LAND), and from the building filter's lower bound on
 *  (BUILDABLE: building/spec.ts roadDistanceRange). */
const CITY_LAND_FIELD = 12;
const CITY_BUILD_FIELD = 23;
/** A cell with fewer buildable core samples than this is a REMNANT. */
const CITY_REMNANT_MIN_CORE = 8;
/** The label of a remnant no full block borders: remnants side by side then merge into one block. */
const CITY_REMNANT_LABEL = 999;

/** The distance to the nearest city wall, SIGNED: positive inside the city. A wall's normal points
 *  from a's cell to b's, and the nearest wall's line decides the side: at a convex corner's vertex
 *  a point is outside both lines, at a concave one inside both, so either wall of a tie agrees. */
const signedCityWallDistance = (px: number, pz: number, walls: Wall[]): number => {
  let best = Infinity;
  let side = 1;
  for (const w of walls) {
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dist = Math.hypot(px - w.sx - dx * t, pz - w.sz - dz * t);
    if (dist < best) {
      best = dist;
      const towardB = (px - w.sx) * w.nx + (pz - w.sz) * w.nz >= 0;
      side = towardB === (w.b.biome.id === CITY_BIOME_ID) ? 1 : -1;
    }
  }
  return best * side;
};

/** A cell surveyed: its plain block index, its super-cell's shape, and what the edge roads leave of
 *  it — its buildable core samples, its LAND samples, and those on each side (W, E, S, N: the half
 *  toward that neighbor, middle row/column included). A sample's edge field is the nearest of the belt
 *  (outside the city: no land), the district's arterials and a river's quay road (on its river side:
 *  no land), by the road field's own formulas — from the walls, the arterial curves and the raw river
 *  pieces alone: a cell is built mid-vertex, where no terrain may run. */
interface CellSurvey {
  plain: number;
  shape: number;
  core: number;
  land: number;
  sides: [number, number, number, number];
}
const cellSurveyCache = new Map<string, CellSurvey>();
const cellSurvey = (ix: number, iz: number, walls: Wall[], d: CityDistrict): CellSurvey => {
  const key = `${d.key}|${ix},${iz}`;
  let r = cellSurveyCache.get(key);
  if (r) return r;
  const city = domainConfig!.cityConfig;
  const gs = city.gridSize;
  const scale = city.roadWidth / city.freewayWidth;
  const rv = domainConfig!.river;
  const n = CITY_CELL_SAMPLES;
  const c0 = (n - CITY_CORE_SAMPLES) / 2;
  const world = cityLocalToWorld((ix + 0.5) * gs, (iz + 0.5) * gs, d);
  const center = warp(world.x, world.z);
  const half = gs * Math.SQRT1_2 + warpMax();
  const pieces = riversEnabled ? riverPiecesNear(center.x - half, center.z - half, center.x + half, center.z + half, riverWetReach() + city.roadWidth + CITY_BUILD_FIELD) : [];
  // Only walls that can be some sample's nearest (within its distance from the center + 2 × half).
  const centerBelt = Math.abs(signedCityWallDistance(center.x, center.z, walls));
  const near = walls.filter((w) => distanceToWall(center.x, center.z, [w]) <= centerBelt + 2 * half);
  r = { plain: plainCityLabel(ix, iz, d), shape: superCellShape(ix, iz, walls, d), core: 0, land: 0, sides: [0, 0, 0, 0] };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const w = cityLocalToWorld((ix + (a + 0.5) / n) * gs, (iz + (b + 0.5) / n) * gs, d);
      // The arterials are laid out in the world, the belt and the rivers in warped space.
      const p = warp(w.x, w.z);
      const belt = signedCityWallDistance(p.x, p.z, near);
      let edge = belt < 0 ? -1 : Math.min(freewayField(belt, CITY_BELT_RECOVER_NORM, scale), freewayField(cityArterialDist(w.x, w.z, d), CITY_ARTERIAL_RECOVER_NORM, scale));
      for (let i = 0; i < pieces.length && edge >= CITY_LAND_FIELD; i++) {
        const q = pieces[i];
        const dx = q.ex - q.sx;
        const dz = q.ez - q.sz;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((p.x - q.sx) * dx + (p.z - q.sz) * dz) / l2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const quay = Math.hypot(p.x - q.sx - dx * t, p.z - q.sz - dz * t) - (rv.halfWidth + rv.bank) * (q.w0 + (q.w1 - q.w0) * t) - city.roadWidth;
        edge = Math.min(edge, quay < 0 ? -1 : quay);
      }
      if (edge >= CITY_BUILD_FIELD && a >= c0 && a < c0 + CITY_CORE_SAMPLES && b >= c0 && b < c0 + CITY_CORE_SAMPLES) r.core++;
      if (edge >= CITY_LAND_FIELD) {
        r.land++;
        if (2 * a <= n - 1) r.sides[0]++;
        if (2 * a >= n - 1) r.sides[1]++;
        if (2 * b <= n - 1) r.sides[2]++;
        if (2 * b >= n - 1) r.sides[3]++;
      }
    }
  }
  if (cellSurveyCache.size > 20000) dropOldestHalf(cellSurveyCache);
  cellSurveyCache.set(key, r);
  return r;
};

/** A cell's own block index (no shape feature, no remnant). */
const plainCityLabel = (ix: number, iz: number, d: CityDistrict): number => {
  const gs = domainConfig!.cityConfig.gridSize;
  return Math.floor(seedRand(`${d.key}|${(ix + 0.5) * gs},${(iz + 0.5) * gs}`) * domainConfig!.cityConfig.blockCount);
};

/** The shape feature a cell's 2×2 super-cell rolled (one with room), or SQUARE. */
const superCellShape = (ix: number, iz: number, walls: Wall[], d: CityDistrict): number => {
  const city = domainConfig!.cityConfig;
  const sx = Math.floor(ix / 2);
  const sz = Math.floor(iz / 2);
  const superRoll = seedRand(`${city.seed}-super-${d.key}|${sx},${sz}`);
  if (superRoll >= city.roundaboutChance + city.triangleChance || !superCellHasRoom(sx, sz, walls, d)) return CITY_SHAPE_SQUARE;
  if (superRoll < city.roundaboutChance) return CITY_SHAPE_CIRCLE;
  return seedRand(`${city.seed}-tri-${d.key}|${sx},${sz}`) < 0.5 ? CITY_SHAPE_TRI_NE : CITY_SHAPE_TRI_NW;
};

/** W, E, S, N — the order of CellSurvey.sides. */
const NEIGHBOR_STEPS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** The full (non-remnant) square neighbor a remnant joins: the one its land lies toward, then the
 *  fullest (index into NEIGHBOR_STEPS); -1 when none borders it. */
const fullNeighborOf = (ix: number, iz: number, own: CellSurvey, walls: Wall[], d: CityDistrict): CellSurvey | null => {
  let best: CellSurvey | null = null;
  let bestScore = -1;
  for (let k = 0; k < 4; k++) {
    if (own.sides[k] < bestScore) continue;
    const other = cellSurvey(ix + NEIGHBOR_STEPS[k][0], iz + NEIGHBOR_STEPS[k][1], walls, d);
    if (other.core < CITY_REMNANT_MIN_CORE || other.shape !== CITY_SHAPE_SQUARE) continue;
    if (own.sides[k] === bestScore && other.core <= best!.core) continue;
    best = other;
    bestScore = own.sides[k];
  }
  return best;
};

/** A square cell's label. A REMNANT — too little of it left beside the city's edge roads to stand as
 *  a block — takes the label of the full square neighbor its land lies toward, so the street between
 *  them goes and its land joins that block. With none, it joins through the remnant neighbor its land
 *  lies toward that has one (a corner remnant between two that joined the same block); with neither,
 *  it takes CITY_REMNANT_LABEL, so a strip of remnants (between a quay and the belt) is one block.
 *  Two steps at most, each from cellSurvey alone, so nothing recurses. */
const squareCityLabel = (ix: number, iz: number, walls: Wall[], d: CityDistrict): number => {
  const own = cellSurvey(ix, iz, walls, d);
  if (own.core >= CITY_REMNANT_MIN_CORE) return own.plain;
  const full = fullNeighborOf(ix, iz, own, walls, d);
  if (full) return full.plain;
  let bestScore = -1;
  let label = CITY_REMNANT_LABEL;
  for (let m = 0; m < 4; m++) {
    if (own.sides[m] <= bestScore) continue;
    const mx = ix + NEIGHBOR_STEPS[m][0];
    const mz = iz + NEIGHBOR_STEPS[m][1];
    const via = cellSurvey(mx, mz, walls, d);
    if (via.shape !== CITY_SHAPE_SQUARE) continue;
    const joined = fullNeighborOf(mx, mz, via, walls, d);
    if (!joined) continue;
    bestScore = own.sides[m];
    label = joined.plain;
  }
  return label;
};

/** The label a cell gets when it is NOT a roundabout member; null when it is.
 *  Non-recursive, so roundabout members can copy an outward neighbor's label. */
const baseCityLabel = (ix: number, iz: number, walls: Wall[], d: CityDistrict): number | null => {
  const shape = cellSurvey(ix, iz, walls, d).shape;
  if (shape === CITY_SHAPE_CIRCLE) return null;
  if (shape !== CITY_SHAPE_SQUARE) return cityUniqueLabel(Math.floor(ix / 2), Math.floor(iz / 2));
  return squareCityLabel(ix, iz, walls, d);
};

// Nested numeric maps: a flat string key allocated ~10 strings per city vertex on HITS.
interface CityCellStore {
  count: number;
  districts: Map<string, Map<number, Map<number, CityCell>>>;
}
const cityCellCaches: { [seed: string]: CityCellStore } = {};

const cityCellLookup = (store: CityCellStore, dKey: string, ix: number, iz: number): CityCell | undefined =>
  store.districts.get(dKey)?.get(ix)?.get(iz);

/** The cell if it is already cached — no walls needed (the enumerators pay for those only on a miss). */
export const peekCityCell = (ix: number, iz: number, d: CityDistrict): CityCell | undefined => {
  const store = cityCellCaches[domainConfig!.cityConfig.seed];
  return store && cityCellLookup(store, d.key, ix, iz);
};

/** The room / remnant verdicts read the CALLER's walls, whose circumcenters differ between biome-grid
 *  windows in the last bits (measured ≤ 2e-10u); the caches keep the first caller's. Order-free only
 *  while no sample sits that close to a threshold. */
export const getCityCell = (ix: number, iz: number, walls: Wall[], d: CityDistrict): CityCell => {
  const city = domainConfig!.cityConfig;
  let store = cityCellCaches[city.seed];
  if (!store) store = cityCellCaches[city.seed] = { count: 0, districts: new Map() };
  let cell = cityCellLookup(store, d.key, ix, iz);
  if (cell === undefined) {
    if (store.count > 20000) {
      // Drop the oldest half of the DISTRICTS (insertion order ≈ distance)
      let drop = Math.max(1, store.districts.size >> 1);
      for (const [dk, dm] of store.districts) {
        if (drop-- <= 0) break;
        dm.forEach((col) => (store.count -= col.size));
        store.districts.delete(dk);
      }
    }
    const survey = cellSurvey(ix, iz, walls, d);
    const shape = survey.shape;
    if (shape === CITY_SHAPE_CIRCLE) {
      // Members COPY an outward neighbor's label so the wrap-around blocks merge
      // with the surrounding grid; differing copied labels become the streets
      // radiating from the ring (getCityTerrain suppresses them inside it).
      const sx = Math.floor(ix / 2);
      const sz = Math.floor(iz / 2);
      const nx = ix === 2 * sx ? 2 * sx - 1 : 2 * sx + 2; // outward x neighbor
      const nz = iz === 2 * sz ? 2 * sz - 1 : 2 * sz + 2; // outward z neighbor
      const copied = baseCityLabel(nx, iz, walls, d) ?? baseCityLabel(ix, nz, walls, d);
      cell = { label: copied ?? survey.plain, shape, edged: false };
    } else if (shape !== CITY_SHAPE_SQUARE) {
      // One unique label across the super-cell guarantees boundary streets, so the diagonal ends in intersections.
      cell = { label: cityUniqueLabel(Math.floor(ix / 2), Math.floor(iz / 2)), shape, edged: false };
    } else {
      cell = { label: squareCityLabel(ix, iz, walls, d), shape, edged: false };
    }
    cell.edged = survey.core < CITY_CORE_SAMPLES * CITY_CORE_SAMPLES;
    let dmap = store.districts.get(d.key);
    if (!dmap) {
      dmap = new Map();
      store.districts.set(d.key, dmap);
    }
    let col = dmap.get(ix);
    if (!col) {
      col = new Map();
      dmap.set(ix, col);
    }
    col.set(iz, cell);
    store.count++;
  }
  return cell;
};

export const clearCityCellCaches = (): void => {
  for (const key of Object.keys(cityCellCaches)) delete cityCellCaches[key];
  cellSurveyCache.clear();
};
