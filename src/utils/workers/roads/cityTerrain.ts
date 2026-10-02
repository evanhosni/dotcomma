/**
 * CITY terrain (CLAUDE.md "City terrain"): staggered rotated DISTRICTS, the block grid inside each,
 * its shape features, the arterials on district boundaries, the belt freeway on the biome wall and
 * the quay roads along rivers — one road field + a plateau elevation per vertex (getCityTerrain).
 * The lookups here are also what the city feature enumerators (cityFeatures.ts) walk.
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { seedRand, smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { warpMax } from "../bridges/constants";
import { warp } from "../noise";
import { smoothMin } from "./freewayNetwork";
import { riverListKey, riverListNearSegment, riverStraight, riverStraightNear } from "../rivers/riverField";
import { riverPiecesNear, riversEnabled, riverWetReach } from "../rivers/riverNetwork";
import type { DomainConfig, RiverQuaySample, Wall } from "../types";
import { distanceToWall, isCanonicalWall } from "../voronoi";

type CityConfig = DomainConfig["cityConfig"];

/** Keyed by block index so merged same-label cells share one plateau. Memoized
 *  with a numeric key: seedRand builds a fresh seedrandom per call and this runs
 *  4-5× per city vertex. */
const cityElevationCache = new Map<number, number>();
let cityElevationCacheSeed = "";
const cityBlockElevation = (
  citySeed: string,
  blockIndex: number | undefined,
  maxElevation: number
): number => {
  if (blockIndex === undefined || blockIndex < 0) return 0;
  if (cityElevationCacheSeed !== citySeed) {
    cityElevationCache.clear();
    cityElevationCacheSeed = citySeed;
  }
  let h = cityElevationCache.get(blockIndex);
  if (h === undefined) {
    h = seedRand(`${citySeed}-elevation-${blockIndex}`) * maxElevation;
    cityElevationCache.set(blockIndex, h);
  }
  return h;
};

export interface CityTerrain {
  roadDistance: number; // to the nearest road centerline, in street units
  relativeElevation: number; // relative to the regional base (computeVertexData adds it back)
  /** The curb dip relativeElevation includes: a shore lift is applied UNDER it (computeVertexData). */
  curbDip: number;
  freewayDistance: number; // real units to the nearest freeway centerline (lane paint)
  freewayAlong: number; // dash-phase coordinate along that freeway
  freewayReal: number; // real units to the nearest arterial or belt centerline, junction zones included
  /** The lane paint here is the WATERFRONT's (the belt carried along the water): it runs along the
   *  river, so it never "ends" at it (computeVertexData's lane-end rule). */
  paintOnWaterfront: boolean;
  /** Whether an edge road reaches into the vertex's cell or one around it: only there can it pinch off
   *  a block island (a cell no edge road reaches holds its whole core, a building's band). */
  nearEdge: boolean;
}

/** On the river side of a quay road the field keeps growing to this, well past the plaza band: a
 *  cap AT the plaza band zig-zags the interpolated sand/pavement edge with the terrain vertices.
 *  Buildings stay off the bank through the placement filter's river exclusion. */
export const CITY_QUAY_INNER_CAP = 60;

// ── The waterfront (the belt carried along a river) ───────────────────

/** A belt wall counts as DROWNED (the river's footprint reaches over it) across this window centered
 *  where its river-side curb is just dry (bank + freewayWidth), fading in over it (real units). Over 30u
 *  past that line, where a wall leaves the river at an angle its share rose 0.17 in 5u, and the belt's
 *  push past CITY_WATERFRONT_BELT_HOLD tore its outer edge into spikes of curb and sand (screenshot 97);
 *  over 60u past it, dry walls beside a river mouth gave their belt way to a block's tip (103). */
const CITY_WATERFRONT_FADE = 60;
/** How far from a road's centerline its distance still matters to the city (real units): the
 *  belt's field has recovered well past the block band, and its paint and grade are long gone. */
const CITY_WATERFRONT_READ = 80;
/** A wall is drowned only as far as it runs along the river: |cos| of the angle between them. */
const CITY_WATERFRONT_ALIGN_LO = Math.cos((50 * Math.PI) / 180);
const CITY_WATERFRONT_ALIGN_HI = Math.cos((30 * Math.PI) / 180);
/** A drowned wall's belt is pushed this far off (and the waterfront, where no wall is drowned), so the
 *  two hand the road over continuously: min() of the two, rounded by CITY_WATERFRONT_FILLET. The
 *  push grows over CITY_WATERFRONT_FADE — a steeper one aliases into a staircase curb. */
const CITY_WATERFRONT_PENALTY = 45;
/** Where the river drowns a wall partly (its share 0 → 1), the belt stays on it up to
 *  CITY_WATERFRONT_BELT_HOLD, while the waterfront line's push eases off by smoothstep of the share, so
 *  the two overlap there and one road runs on from the other. Pushed away together, linearly (the belt
 *  by the share, the line by the rest), both were ~22u off midway: the belt ended in a stub on the sand
 *  and the waterfront began apart from it, a sidewalk tongue between them (screenshot). With the line
 *  fully in play from a share of 0.4 on instead, a second branch of it ran beside the first where the
 *  river's quay field folds, and the ridge between drew as a row of curb teeth. */
const CITY_WATERFRONT_BELT_HOLD = 0.6;
/** The smooth minimum's reach where the belt turns onto the waterfront: a rounded corner. */
const CITY_WATERFRONT_FILLET = 30;
/** Off the city the waterfront line is pushed away by this many units per unit outside the wall: on
 *  the wall it is the city's, so the two halves meet, and it never runs on into the neighbor. */
const CITY_WATERFRONT_OUTSIDE_PUSH = 3;
/** The waterfront line comes into play as a drowned wall's share (wf) grows past CITY_WATERFRONT_ONSET:
 *  below it the line is pushed up to CITY_WATERFRONT_ABSENT off, past any belt distance (real units). */
const CITY_WATERFRONT_ONSET = 0.1;
const CITY_WATERFRONT_ABSENT = 1e4;

/** How far a (warped) point of a city wall is DROWNED, 0–1: the river's footprint reaches its belt's
 *  river-side curb. From the current vertex's river piece list (riverStraightNear). */
export const wallDrownedAt = (px: number, pz: number, wallDx = NaN, wallDz = NaN): number => {
  riverStraightNear(px, pz);
  if (!(riverStraight.distance < Infinity)) return 0;
  const rv = domainConfig!.river;
  const edge = (rv.halfWidth + rv.bank) * riverStraight.factor + domainConfig!.cityConfig.freewayWidth;
  const drowned = 1 - smoothstep(edge - CITY_WATERFRONT_FADE / 2, edge + CITY_WATERFRONT_FADE / 2, riverStraight.distance);
  if (Number.isNaN(wallDx)) return drowned;
  // Only a wall running ALONG the river: a belt crossing it is decked, not drowned (its closest
  // point to a vertex beside the crossing lies in the channel).
  const l = Math.hypot(wallDx, wallDz) || 1;
  return drowned * smoothstep(CITY_WATERFRONT_ALIGN_LO, CITY_WATERFRONT_ALIGN_HI, Math.abs(wallDx * riverStraight.dirX + wallDz * riverStraight.dirZ) / l);
};

/** wallDrownedAt along a wall, sampled at WALL_DROWNED_SAMPLES points per wall and river list and
 *  interpolated (asked per vertex for every wall beside a river it cost ~15 ms per LOD1 chunk). */
const WALL_DROWNED_SAMPLES = 17;
const wallDrownedCache = new WeakMap<Wall, { list: unknown; v: Float64Array }>();
const wallDrownedAlong = (w: Wall, t: number): number => {
  const list = riverListKey();
  let hit = wallDrownedCache.get(w);
  if (!hit || hit.list !== list) {
    const v = new Float64Array(WALL_DROWNED_SAMPLES);
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    for (let k = 0; k < WALL_DROWNED_SAMPLES; k++) {
      const u = k / (WALL_DROWNED_SAMPLES - 1);
      v[k] = wallDrownedAt(w.sx + dx * u, w.sz + dz * u, dx, dz);
    }
    hit = { list, v };
    wallDrownedCache.set(w, hit);
  }
  const f = t * (WALL_DROWNED_SAMPLES - 1);
  const k = Math.min(WALL_DROWNED_SAMPLES - 2, Math.floor(f));
  return hit.v[k] + (hit.v[k + 1] - hit.v[k]) * (f - k);
};

/** The WATERFRONT: the city's belt freeway continues along the river instead of stopping at the water.
 *  Where a city wall lies in a river's footprint, the belt runs along the water's straight edge
 *  instead, its river-side curb on the bank (bank + freewayWidth from the centerline), and rejoins the
 *  belt where the wall comes out of the water — one road, one set of lanes. Off the city (`inCity`
 *  false) the waterfront line is pushed off with the distance from the wall (CITY_WATERFRONT_OUTSIDE_PUSH). Writes waterfrontBelt: `distance`, the real distance to
 *  that road's centerline (the belt's own where no wall is drowned); `waterfront`, how far a drowned
 *  wall is in play (0–1); `onWaterfront`, whether the waterfront line is the nearer part. The vertex's
 *  own river piece list must be current (riverQuayAt ran for it). */
const waterfrontBelt = { distance: Infinity, waterfront: 0, onWaterfront: false };
const findWaterfrontBelt =(wx: number, wz: number, walls: Wall[], beltDistance: number, quay: RiverQuaySample, inCity: boolean): void => {
  waterfrontBelt.distance = beltDistance;
  waterfrontBelt.waterfront = 0;
  waterfrontBelt.onWaterfront = false;
  if (!(quay.distance < Infinity) || walls.length === 0) return;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const fw = domainConfig!.cityConfig.freewayWidth;
  // Far from every wall and from where a waterfront could run, nothing here reads the belt's
  // distance any more (its field has recovered, no paint or grade reaches this far).
  if (beltDistance > CITY_WATERFRONT_READ && Math.abs(quay.distance - (reach * quay.factor + fw)) > CITY_WATERFRONT_READ) return;
  let dry = Infinity;
  let wf = 0;
  // Past this a wall changes nothing: the nearest wall alone keeps the belt within beltDistance + the
  // penalty. A drowned wall's waterfront fades out over CITY_WATERFRONT_FADE before it (cut off there, the
  // waterfront switched on at once: 1.9u of plateau at (-954, 1034)).
  const farthest = beltDistance + CITY_WATERFRONT_PENALTY;
  const bank = reach * quay.factor;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    // Each wall is listed twice, endpoint-swapped.
    if (!isCanonicalWall(w)) continue;
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((wx - w.sx) * dx + (wz - w.sz) * dz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = w.sx + dx * t;
    const pz = w.sz + dz * t;
    const dist = Math.hypot(wx - px, wz - pz);
    if (dist > farthest) continue;
    // A wall nowhere near the river is never drowned (the common case: a quick test per wall).
    if (!riverListNearSegment(w, w.sx, w.sz, w.ex, w.ez, reach, fw + CITY_WATERFRONT_FADE)) {
      dry = Math.min(dry, dist);
      continue;
    }
    const drowned = wallDrownedAlong(w, t);
    if (drowned <= 0) {
      dry = Math.min(dry, dist);
      continue;
    }
    const near = (1 - smoothstep(quay.distance + bank, quay.distance + bank + CITY_WATERFRONT_FADE, dist)) * (1 - smoothstep(farthest - CITY_WATERFRONT_FADE, farthest, dist));
    wf = Math.max(wf, drowned * near);
    dry = Math.min(dry, dist + CITY_WATERFRONT_PENALTY * smoothstep(CITY_WATERFRONT_BELT_HOLD, 1, drowned));
  }
  if (wf <= 0) {
    waterfrontBelt.distance = dry;
    return;
  }
  // Off the city the line is pushed away with the distance from the wall: it would run on along the
  // river past the city's corner, into the grass.
  // Where the waterfront barely starts (wf → 0) the line is pushed out of play: 45u off at most, it took
  // the belt over the moment any wall was drowned at all — 0.3u curb steps along that line.
  const fadeIn = CITY_WATERFRONT_ABSENT * (1 - smoothstep(0, CITY_WATERFRONT_ONSET, wf));
  const line = Math.abs(quay.distance - (reach * quay.factor + fw)) + CITY_WATERFRONT_PENALTY * (1 - smoothstep(0, 1, wf)) + fadeIn + (inCity ? 0 : CITY_WATERFRONT_OUTSIDE_PUSH * beltDistance);
  waterfrontBelt.distance = smoothMin(dry, line, CITY_WATERFRONT_FILLET);
  waterfrontBelt.waterfront = wf;
  waterfrontBelt.onWaterfront = line < dry;
};

/** The belt's distance from a point OFF the city (real units, from the nearest city wall's
 *  `beltDistance`): the city's own measure, its waterfront line fading off the wall, so where the river
 *  drowns a wall the outer half is pushed off it exactly as the inner half is. riverQuayAt must have run. */
export const drownedBeltDistance = (wx: number, wz: number, walls: Wall[], beltDistance: number, quay: RiverQuaySample): number => {
  findWaterfrontBelt(wx, wz, walls, beltDistance, quay, false);
  return waterfrontBelt.distance;
};

// ── Blocks: shapes and cells ──────────────────────────────────────────

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
const cityUniqueLabel = (ix: number, iz: number): number =>
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

/** A freeway's field (street units) `real` units from its centerline: squashed into street units,
 *  recovering at CITY_ARTERIAL_RECOVER_SLOPE past `recoverNorm` (max() keeps it continuous). */
const freewayField = (real: number, recoverNorm: number, freewayToStreetScale: number): number =>
  Math.max(real * freewayToStreetScale, (real - recoverNorm / freewayToStreetScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm);

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

// ── Districts and arterials ───────────────────────────────────────────

// Districts: jittered rows ~districtSize cells tall, split into staggered jittered
// segments. Each rotates its whole block grid by a seeded multiple of 15° about its
// center; district boundaries carry the arterial roads, which hide the grid seams.

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

// ── getCityTerrain, step by step (workers are single-threaded: the steps share module scratch) ──

// Plateau ramps extend this far past the road half-width (across the sidewalk) for gentle grades.
const CITY_RAMP_SPAN = 4;

// The chamfer cut sits at dᵢ + dⱼ = roadWidth / scale (≈ 28.6u at 0.35);
// fragments pinched narrower than that become road entirely.
const CITY_CHAMFER_SCALE = 0.35;

// A pair only chamfers when its toward-road directions differ (corner wedge or
// pinch: dot ≤ 0). A road event ACROSS the street points the same way (dot ≈ +1)
// and must not notch this block's edge; the penalty fades in over [LO, HI].
const CITY_CHAMFER_DOT_LO = 0.6;
const CITY_CHAMFER_DOT_HI = 0.85;
const CITY_CHAMFER_DOT_PENALTY = 60;

// The ×(roadWidth/freewayWidth) squash applies up to this normalized value (just past the interior
// band at 12), then the field recovers at the steep slope, so the blocks along an arterial are not
// all setback (no building band).
const CITY_ARTERIAL_RECOVER_NORM = 12.2;
const CITY_ARTERIAL_RECOVER_SLOPE = 3;
/** The belt's recovery start (normalized): 9.5 = 19u real, one curb strip past its asphalt. */
const CITY_BELT_RECOVER_NORM = 9.5;

// Real units from a freeway centerline over which plateaus ramp to full height: from the asphalt's
// edge, so a freeway is flat across its lanes (a ramp starting nearer the centerline slopes the lanes
// toward the blocks and creases the belt down its middle at the wall); the end must stay inside the
// building setback (~35u) so block interiors are flat.
const CITY_FREEWAY_RAMP_START = 14;
const CITY_FREEWAY_RAMP_END = 34;


/** The current vertex's 3×3 cell labels: neighborLabels[(a+1)*3 + (b+1)] = label of cell (ix+a, iz+b);
 *  neighborsEdged: whether an edge road reaches into any of them. */
const neighborLabels: number[] = [];
let neighborsEdged = false;
const readNeighborLabels = (ix: number, iz: number, walls: Wall[], d: CityDistrict): void => {
  neighborsEdged = false;
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const c = getCityCell(ix + a, iz + b, walls, d);
      neighborLabels[(a + 1) * 3 + (b + 1)] = c.label;
      if (c.edged) neighborsEdged = true;
    }
  }
};

/** The current vertex's road CONSTRAINTS: distance + toward-road unit direction in the WORLD frame
 *  (NaN = pairable with anything: the belt). */
const MAX_ROAD_CONSTRAINTS = 24;
const roadConstraintDist = new Float64Array(MAX_ROAD_CONSTRAINTS);
const roadConstraintDirX = new Float64Array(MAX_ROAD_CONSTRAINTS);
const roadConstraintDirZ = new Float64Array(MAX_ROAD_CONSTRAINTS);
let roadConstraintCount = 0;
/** The district whose local frame addLocalConstraint's directions are rotated out of. */
let constraintFrame: CityDistrict | null = null;

const beginRoadConstraints = (d: CityDistrict): void => {
  roadConstraintCount = 0;
  constraintFrame = d;
};
const addLocalConstraint = (dd: number, lux: number, luz: number): void => {
  if (roadConstraintCount >= MAX_ROAD_CONSTRAINTS) return;
  const d = constraintFrame!;
  roadConstraintDist[roadConstraintCount] = dd;
  roadConstraintDirX[roadConstraintCount] = lux * d.cos - luz * d.sin;
  roadConstraintDirZ[roadConstraintCount] = lux * d.sin + luz * d.cos;
  roadConstraintCount++;
};
const addWorldConstraint = (dd: number, wux: number, wuz: number): void => {
  if (roadConstraintCount >= MAX_ROAD_CONSTRAINTS) return;
  roadConstraintDist[roadConstraintCount] = dd;
  roadConstraintDirX[roadConstraintCount] = wux;
  roadConstraintDirZ[roadConstraintCount] = wuz;
  roadConstraintCount++;
};

/** The current vertex against its roundabout (a CITY_SHAPE_CIRCLE cell): its distance from the ring's
 *  center, the ring road's centerline radius, the unit direction center → vertex (local), and whether
 *  it is inside the ring. */
const roundabout = { distance: Infinity, ringRadius: 0, ux: 1, uz: 0, inside: false };
const measureRoundabout = (cell: CityCell, ix: number, iz: number, lx: number, lz: number, gs: number): void => {
  roundabout.distance = Infinity;
  roundabout.ringRadius = 0;
  roundabout.ux = 1;
  roundabout.uz = 0;
  if (cell.shape === CITY_SHAPE_CIRCLE) {
    const scx = (2 * Math.floor(ix / 2) + 1) * gs;
    const scz = (2 * Math.floor(iz / 2) + 1) * gs;
    roundabout.distance = Math.hypot(lx - scx, lz - scz);
    roundabout.ringRadius = gs * CITY_RING_RADIUS_FRAC;
    if (roundabout.distance > 1e-6) {
      roundabout.ux = (lx - scx) / roundabout.distance;
      roundabout.uz = (lz - scz) / roundabout.distance;
    }
  }
  roundabout.inside = roundabout.distance < roundabout.ringRadius;
};

/** STREETS: boundary SEGMENTS between differing labels over the full 3×3 neighborhood, contiguous
 *  collinear pieces MERGED into one run. Per-cell infinite lines would pop the chamfer's second
 *  constraint at cell borders (notched road edges), and unmerged collinear pieces would make the
 *  chamfer pair two pieces of the SAME road (notched sidewalks at every merged-block seam). */
const addBoundaryStreets = (ix: number, iz: number, lx: number, lz: number, gs: number): void => {
  // Vertical boundary lines (between cell columns a and a+1):
  for (let a = -1; a <= 0; a++) {
    const X = (ix + a + 1) * gs;
    let runStart = 99;
    for (let b = -1; b <= 2; b++) {
      const differs = b <= 1 && neighborLabels[(a + 1) * 3 + (b + 1)] !== neighborLabels[(a + 2) * 3 + (b + 1)];
      if (differs && runStart === 99) runStart = b;
      if (!differs && runStart !== 99) {
        const z0 = (iz + runStart) * gs;
        const z1 = (iz + b) * gs;
        const ddx = X - lx;
        const ddz = lz < z0 ? z0 - lz : lz > z1 ? z1 - lz : 0;
        const dd = Math.hypot(ddx, ddz);
        if (dd < 1e-6) addLocalConstraint(0, 1, 0);
        else addLocalConstraint(dd, ddx / dd, ddz / dd);
        runStart = 99;
      }
    }
  }
  // Horizontal boundary lines (between cell rows b and b+1):
  for (let b = -1; b <= 0; b++) {
    const Z = (iz + b + 1) * gs;
    let runStart = 99;
    for (let a = -1; a <= 2; a++) {
      const differs = a <= 1 && neighborLabels[(a + 1) * 3 + (b + 1)] !== neighborLabels[(a + 1) * 3 + (b + 2)];
      if (differs && runStart === 99) runStart = a;
      if (!differs && runStart !== 99) {
        const x0 = (ix + runStart) * gs;
        const x1 = (ix + a) * gs;
        const ddz = Z - lz;
        const ddx = lx < x0 ? x0 - lx : lx > x1 ? x1 - lx : 0;
        const dd = Math.hypot(ddx, ddz);
        if (dd < 1e-6) addLocalConstraint(0, 0, 1);
        else addLocalConstraint(dd, ddx / dd, ddz / dd);
        runStart = 99;
      }
    }
  }
};

/** The cell's in-super-cell shape feature (each confined to its own 2×2 super-cell): a triangle's
 *  corner-to-corner diagonal, or a roundabout's ring road. */
const addShapeFeature = (cell: CityCell, ix: number, iz: number, lx: number, lz: number, gs: number): void => {
  if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
    const dx = lx - 2 * Math.floor(ix / 2) * gs;
    const dz = lz - 2 * Math.floor(iz / 2) * gs;
    if (cell.shape === CITY_SHAPE_TRI_NE) {
      // Line x − z = 0 (super-local); gradient (√½, −√½)
      const sig = (dx - dz) * Math.SQRT1_2;
      const f = sig >= 0 ? -1 : 1; // toward the line = −sign · gradient
      addLocalConstraint(Math.abs(sig), f * Math.SQRT1_2, -f * Math.SQRT1_2);
    } else {
      // Line x + z = 2·gs (super-local); gradient (√½, √½)
      const sig = (dx + dz - 2 * gs) * Math.SQRT1_2;
      const f = sig >= 0 ? -1 : 1;
      addLocalConstraint(Math.abs(sig), f * Math.SQRT1_2, f * Math.SQRT1_2);
    }
  } else if (cell.shape === CITY_SHAPE_CIRCLE) {
    // The island's field is compressed ×0.75 so buildings keep a margin from the curved curb.
    if (roundabout.inside) addLocalConstraint((roundabout.ringRadius - roundabout.distance) * 0.75, roundabout.ux, roundabout.uz);
    else addLocalConstraint(roundabout.distance - roundabout.ringRadius, -roundabout.ux, -roundabout.uz);
  }
};

/** The district's four wiggly ARTERIALS at the vertex (real units; WORLD-aligned — only district
 *  interiors rotate): each side's distance, and the nearest one's distance (≥ 0) and dash phase. */
const arterials = { south: 0, north: 0, west: 0, east: 0, real: 0, along: 0 };
/** Measures the arterials and adds the nearest as a constraint, normalized into street units so ONE
 *  road field drives the shader bands, curb dip and spawn filters. */
const addArterialConstraint = (vx: number, vz: number, d: CityDistrict, freewayToStreetScale: number): void => {
  const south = vz - cityRowEdgeZ(d.r, vx);
  const north = cityRowEdgeZ(d.r + 1, vx) - vz;
  const west = vx - citySegEdgeX(d.r, d.m, vz);
  const east = citySegEdgeX(d.r, d.m + 1, vz) - vx;
  let real = south;
  let ux = 0;
  let uz = -1;
  let along = vx; // row boundaries run along x
  if (north < real) {
    real = north;
    ux = 0;
    uz = 1;
    along = vx;
  }
  if (west < real) {
    real = west;
    ux = -1;
    uz = 0;
    along = vz; // segment boundaries run along z
  }
  if (east < real) {
    real = east;
    ux = 1;
    uz = 0;
    along = vz;
  }
  real = Math.max(0, real);
  addWorldConstraint(freewayField(real, CITY_ARTERIAL_RECOVER_NORM, freewayToStreetScale), ux, uz);
  arterials.south = south;
  arterials.north = north;
  arterials.west = west;
  arterials.east = east;
  arterials.real = real;
  arterials.along = along;
};

/** The BELT freeway, CENTERED ON the biome wall — carried along the water where its wall is drowned
 *  (findWaterfrontBelt): its inner half is the city's rim, its outer half rides the neighbor biome like
 *  an inter-city run (computeVertexData step 5), so a run leaving a wall junction meets it as one
 *  network node. No direction (the boundary curves): it pairs with anything in the chamfer. Its field
 *  recovers from CITY_BELT_RECOVER_NORM, earlier than an arterial's: as a partner in every chamfer
 *  along the rim, the squashed distance would eat every block corner beside it into plaza. Returns the
 *  belt's real distance. */
/** The belt constraint's field at the current vertex (addBeltConstraint). */
let lastBeltField = 0;
/** At the wall the city's road field is the belt's — what the neighbor side reads there — falling off
 *  at this many street units per real unit inside it: steeper than the belt's own field ever climbs
 *  (CITY_ARTERIAL_RECOVER_SLOPE), so it only acts where a drowned wall's belt moved onto the
 *  waterfront — a street running into such a wall dipped its curb against a neighbor with no road at
 *  all (0.3u). Elsewhere the belt's field IS the nearest constraint at the wall. */
const CITY_WALL_FIELD_FALLOFF = CITY_ARTERIAL_RECOVER_SLOPE + 1;
const addBeltConstraint = (warped: PointXZ, walls: Wall[], biomeBoundaryDist: number, quay: RiverQuaySample, freewayToStreetScale: number): number => {
  findWaterfrontBelt(warped.x, warped.z, walls, biomeBoundaryDist, quay, true);
  const beltReal = waterfrontBelt.distance;
  const beltField = freewayField(beltReal, CITY_BELT_RECOVER_NORM, freewayToStreetScale);
  addWorldConstraint(beltField, NaN, 0);
  lastBeltField = beltField;
  return beltReal;
};

/** A RIVER through the city: a QUAY ROAD along each bank, its inner curb at the bank's outer edge, so
 *  blocks melt against it like any street. Measured from the STRAIGHT (un-meandered) river field —
 *  distance, width factor and direction — so its edges stay straight while the channel winds inside
 *  the bank. On the river side of its inner curb the field is the quay's own (`only`, faded in by
 *  `riverSide`): streets tee into the quay instead of running down the embankment into the water. */
const quayRoad = { only: 99, riverSide: 0 };
const addQuayConstraint = (quay: RiverQuaySample, city: CityConfig): void => {
  quayRoad.only = 99;
  quayRoad.riverSide = 0;
  if (!(quay.distance < Infinity)) return;
  const rv = domainConfig!.river;
  const quayOffset = (rv.halfWidth + rv.bank) * quay.factor + city.roadWidth;
  if (quay.distance >= quayOffset) addWorldConstraint(quay.distance - quayOffset, quay.dirX, quay.dirZ);
  else {
    quayRoad.only = Math.min(CITY_QUAY_INNER_CAP, quayOffset - quay.distance);
    addWorldConstraint(quayRoad.only, -quay.dirX, -quay.dirZ);
    quayRoad.riverSide = 1 - smoothstep(quayOffset - city.roadWidth, quayOffset - city.roadWidth * 0.5, quay.distance);
  }
};

/** Bilinear plateau interpolation toward the neighbors the vertex leans into (same label → same
 *  height → no seam), ramping across street AND sidewalk. */
const plateauElevation = (lx: number, lz: number, ix: number, iz: number, cellLabel: number, walls: Wall[], d: CityDistrict, city: CityConfig): number => {
  const gs = city.gridSize;
  const n = neighborLabels[5]; // (0, +1)
  const e = neighborLabels[7]; // (+1, 0)
  const s = neighborLabels[3]; // (0, −1)
  const w = neighborLabels[1]; // (−1, 0)
  const rampFrac = (city.roadWidth + CITY_RAMP_SPAN) / gs;
  const flatEdge = 0.5 - rampFrac;
  const fx = lx / gs - (ix + 0.5); // [-0.5, 0.5] across the cell
  const fz = lz / gs - (iz + 0.5);
  const wx = 0.5 * smoothstep(flatEdge, 0.5, Math.abs(fx));
  const wz = 0.5 * smoothstep(flatEdge, 0.5, Math.abs(fz));
  const dxi = fx >= 0 ? 1 : -1;
  const dzi = fz >= 0 ? 1 : -1;
  const hC = cityBlockElevation(city.seed, cellLabel, city.maxBlockElevation);
  const hX = cityBlockElevation(city.seed, fx >= 0 ? e : w, city.maxBlockElevation);
  const hZ = cityBlockElevation(city.seed, fz >= 0 ? n : s, city.maxBlockElevation);
  const hD = cityBlockElevation(city.seed, getCityCell(ix + dxi, iz + dzi, walls, d).label, city.maxBlockElevation);
  return hC * (1 - wx) * (1 - wz) + hX * wx * (1 - wz) + hZ * (1 - wx) * wz + hD * wx * wz;
};

/** Pairwise LINEAR chamfer/melt over the constraints: (dᵢ + dⱼ) is constant along straight lines, so
 *  corners get 45° cuts and pinched fragments become road. Fully pairwise (argmin pairing switches
 *  identity discontinuously) and linear (a smoothstep-scaled melt rounds every block into a blob). */
const chamferedRoadDistance = (): number => {
  let nearestConstraint = 99;
  for (let i = 0; i < roadConstraintCount; i++) if (roadConstraintDist[i] < nearestConstraint) nearestConstraint = roadConstraintDist[i];
  let chamfer = 99;
  for (let i = 0; i < roadConstraintCount; i++) {
    for (let j = i + 1; j < roadConstraintCount; j++) {
      let pen = 0;
      if (!Number.isNaN(roadConstraintDirX[i]) && !Number.isNaN(roadConstraintDirX[j])) {
        const dot = roadConstraintDirX[i] * roadConstraintDirX[j] + roadConstraintDirZ[i] * roadConstraintDirZ[j];
        pen = CITY_CHAMFER_DOT_PENALTY * smoothstep(CITY_CHAMFER_DOT_LO, CITY_CHAMFER_DOT_HI, dot);
      }
      const c = (roadConstraintDist[i] + roadConstraintDist[j] + pen) * CITY_CHAMFER_SCALE;
      if (c < chamfer) chamfer = c;
    }
  }
  return Math.min(nearestConstraint, chamfer);
};

/** The lane paint's distance (real) and dash phase: the nearer of the arterial and the belt, or no
 *  paint (99999) in a JUNCTION ZONE — a second freeway feature within reach — so lines end cleanly
 *  before interchanges. */
const lanePaint = { distance: 99999, along: 0 };
const measureLanePaint = (beltReal: number, biomeWallAlong: number, city: CityConfig): void => {
  let freewayDistance = arterials.real;
  let freewayAlong = arterials.along;
  if (beltReal < freewayDistance) {
    freewayDistance = beltReal;
    freewayAlong = biomeWallAlong;
  }
  let m1 = 99999;
  let m2 = 99999;
  for (const v of [Math.max(0, arterials.south), Math.max(0, arterials.north), Math.max(0, arterials.west), Math.max(0, arterials.east), beltReal]) {
    if (v < m1) {
      m2 = m1;
      m1 = v;
    } else if (v < m2) {
      m2 = v;
    }
  }
  if (m2 < city.freewayWidth + 10) {
    freewayDistance = 99999;
    freewayAlong = 0;
  }
  lanePaint.distance = freewayDistance;
  lanePaint.along = freewayAlong;
};

/** The city at (vx, vz): `walls` are the CITY's walls (the belt), `biomeBoundaryDist`/`biomeWallAlong` the
 *  vertex's distance to and phase along the nearest of them, `quay` the straight river field. The
 *  steps' order is part of the output (getCityCell caches by first query). */
export const getCityTerrain = (
  vx: number,
  vz: number,
  city: CityConfig,
  walls: Wall[],
  biomeBoundaryDist: number,
  biomeWallAlong: number,
  quay: RiverQuaySample,
  warped: PointXZ
): CityTerrain => {
  const gs = city.gridSize;

  // Rotate into the district's LOCAL grid frame; distances and heights are rotation-invariant, so nothing is transformed back.
  const d = getCityDistrict(vx, vz);
  const rdx = vx - d.px;
  const rdz = vz - d.pz;
  const lx = d.px + rdx * d.cos + rdz * d.sin;
  const lz = d.pz - rdx * d.sin + rdz * d.cos;
  const ix = Math.floor(lx / gs);
  const iz = Math.floor(lz / gs);
  const cell = getCityCell(ix, iz, walls, d);
  readNeighborLabels(ix, iz, walls, d);

  // The road constraints. Inside a roundabout's ring the boundary streets are suppressed, so the
  // members' internal boundaries tee into the ring road instead of slicing the island.
  beginRoadConstraints(d);
  measureRoundabout(cell, ix, iz, lx, lz, gs);
  if (!roundabout.inside) addBoundaryStreets(ix, iz, lx, lz, gs);
  addShapeFeature(cell, ix, iz, lx, lz, gs);
  const freewayToStreetScale = city.roadWidth / city.freewayWidth;
  addArterialConstraint(vx, vz, d, freewayToStreetScale);
  const beltReal = addBeltConstraint(warped, walls, biomeBoundaryDist, quay, freewayToStreetScale);
  const paintOnWaterfront = waterfrontBelt.onWaterfront && waterfrontBelt.waterfront > 0.5;
  addQuayConstraint(quay, city);

  let elevation = plateauElevation(lx, lz, ix, iz, cell.label, walls, d, city);
  // Freeways sit at MID-PLATEAU grade so elevation stays continuous across the district switch
  // (grade 0 with a tight ramp reads as a V trough). Outside the belt centerline the city stays AT
  // grade all the way to the wall: the value zoneBiomeHeight continues past it, so the neighbor's
  // height ramp starts from the freeway surface with no step.
  const freewayGrade = city.maxBlockElevation * 0.5;
  // By the wall itself too where a drowned wall's belt moved onto the waterfront: the city outside its
  // zone is AT grade (zoneBiomeHeight), and a plateau running into the river met it 1.5u off.
  const freewayRamp = smoothstep(CITY_FREEWAY_RAMP_START, CITY_FREEWAY_RAMP_END, arterials.real) * smoothstep(CITY_FREEWAY_RAMP_START, CITY_FREEWAY_RAMP_END, Math.min(beltReal, biomeBoundaryDist));
  elevation = freewayGrade + (elevation - freewayGrade) * freewayRamp;
  // Roundabout island: its own flat plateau, blended in under the inner ring road.
  if (roundabout.inside) {
    const islandH = cityBlockElevation(city.seed, cityUniqueLabel(Math.floor(ix / 2), Math.floor(iz / 2)), city.maxBlockElevation);
    const islandMask = 1 - smoothstep(roundabout.ringRadius - 12, roundabout.ringRadius - 2, roundabout.distance);
    elevation += (islandH - elevation) * islandMask;
  }

  let roadDistance = chamferedRoadDistance();
  roadDistance = Math.max(roadDistance, lastBeltField - CITY_WALL_FIELD_FALLOFF * biomeBoundaryDist);
  // On the river side of the quay the field becomes the quay's own. The lerp runs inside the quay's
  // asphalt band, where both fields are ≤ 7, so nothing steps. Freeways are NOT exempt: an arterial
  // ends at the quay like a street, and a deck lands on the quay's pavement like an abutment.
  if (quayRoad.riverSide > 0) roadDistance += (quayRoad.only - roadDistance) * quayRoad.riverSide;

  // The curb dip is full across the belt, wall included — the neighbor side of the belt
  // (computeVertexData step 5) dips by the same formula, so the road meets itself at the wall.
  const curbDip = cityCurbDip(roadDistance);
  elevation -= curbDip;

  measureLanePaint(beltReal, biomeWallAlong, city);
  return {
    roadDistance,
    relativeElevation: elevation,
    curbDip,
    freewayDistance: lanePaint.distance,
    freewayAlong: lanePaint.along,
    freewayReal: Math.min(arterials.real, beltReal),
    paintOnWaterfront: paintOnWaterfront && lanePaint.distance === beltReal,
    nearEdge: neighborsEdged,
  };
};

/** How far the road surface dips under the sidewalk at a road field (street units). */
const cityCurbDip = (roadDistance: number): number => {
  const city = domainConfig!.cityConfig;
  return city.curbHeight * (1 - smoothstep(city.roadWidth - 2, city.roadWidth, roadDistance));
};

/** Everything keyed by seed or by config-derived objects is stale across an init. */
export const clearCityCaches = (): void => {
  for (const key of Object.keys(cityCellCaches)) delete cityCellCaches[key];
  rowWiggleCache.clear();
  segWiggleCache.clear();
  cityRowBoundaryCache.clear();
  citySegBoundaryCache.clear();
  cityDistrictCache.clear();
  cityElevationCache.clear();
  cityElevationCacheSeed = "";
  cellSurveyCache.clear();
};
