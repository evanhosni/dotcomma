/**
 * CITY terrain (CLAUDE.md "City terrain"): per vertex, one road field and a plateau elevation from
 * the district's block cells (cityCells.ts), its shape features, the arterials on district boundaries
 * (cityDistricts.ts), the belt freeway on the biome wall or its waterfront (cityWaterfront.ts) and the
 * quay roads along rivers (getCityTerrain).
 */

import { seedRand, smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { domainConfig } from "../computeConfig";
import type { DomainConfig, RiverQuaySample, Wall } from "../types";
import { CITY_RING_RADIUS_FRAC, CITY_SHAPE_CIRCLE, CITY_SHAPE_TRI_NE, CITY_SHAPE_TRI_NW, type CityCell, clearCityCellCaches, cityUniqueLabel, getCityCell } from "./cityCells";
import { type CityDistrict, cityRowEdgeZ, citySegEdgeX, clearCityDistrictCaches, getCityDistrict } from "./cityDistricts";
import { CITY_ARTERIAL_RECOVER_NORM, CITY_ARTERIAL_RECOVER_SLOPE, CITY_BELT_RECOVER_NORM, CITY_QUAY_INNER_CAP, NO_ROAD_DISTANCE, cityCurbDip, freewayField } from "./cityRoadField";
import { findWaterfrontBelt, waterfrontBelt } from "./cityWaterfront";

type CityConfig = DomainConfig["cityConfig"];

/** A block's plateau height, keyed by block index so merged same-label cells share one plateau;
 *  memoized by number (it runs 4–5× per city vertex). */
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

/** The belt constraint's field at the current vertex (addBeltConstraint). */
let lastBeltField = 0;
/** At the wall the city's road field is the belt's — what the neighbor side reads there — falling off
 *  at this many street units per real unit inside it: steeper than the belt's own field ever climbs
 *  (CITY_ARTERIAL_RECOVER_SLOPE), so it only acts where a drowned wall's belt moved onto the
 *  waterfront — a street running into such a wall dipped its curb against a neighbor with no road at
 *  all (0.3u). Elsewhere the belt's field IS the nearest constraint at the wall. */
const CITY_WALL_FIELD_FALLOFF = CITY_ARTERIAL_RECOVER_SLOPE + 1;
/** The BELT freeway, CENTERED ON the biome wall — carried along the water where its wall is drowned
 *  (findWaterfrontBelt): its inner half is the city's rim, its outer half rides the neighbor biome like
 *  an inter-city run (computeVertexData step 5), so a run leaving a wall junction meets it as one
 *  network node. No direction (the boundary curves): it pairs with anything in the chamfer. Its field
 *  recovers from CITY_BELT_RECOVER_NORM, earlier than an arterial's: as a partner in every chamfer
 *  along the rim, the squashed distance would eat every block corner beside it into plaza. Returns the
 *  belt's real distance. */
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

/** Within freewayWidth + this of a SECOND freeway (an arterial side or the belt), the lane paint stops. */
const CITY_JUNCTION_CLEAR = 10;

/** The two nearest freeway distances fed to considerFreeway since they were reset. */
let nearestFreeway = 0;
let secondFreeway = 0;
const considerFreeway = (v: number): void => {
  if (v < nearestFreeway) {
    secondFreeway = nearestFreeway;
    nearestFreeway = v;
  } else if (v < secondFreeway) {
    secondFreeway = v;
  }
};

/** The lane paint's distance (real) and dash phase: the nearer of the arterial and the belt, or no
 *  paint (NO_ROAD_DISTANCE) in a JUNCTION ZONE — a second freeway feature within reach — so lines end
 *  cleanly before interchanges. */
const lanePaint = { distance: NO_ROAD_DISTANCE, along: 0 };
const measureLanePaint = (beltReal: number, biomeWallAlong: number, city: CityConfig): void => {
  let freewayDistance = arterials.real;
  let freewayAlong = arterials.along;
  if (beltReal < freewayDistance) {
    freewayDistance = beltReal;
    freewayAlong = biomeWallAlong;
  }
  nearestFreeway = NO_ROAD_DISTANCE;
  secondFreeway = NO_ROAD_DISTANCE;
  considerFreeway(Math.max(0, arterials.south));
  considerFreeway(Math.max(0, arterials.north));
  considerFreeway(Math.max(0, arterials.west));
  considerFreeway(Math.max(0, arterials.east));
  considerFreeway(beltReal);
  if (secondFreeway < city.freewayWidth + CITY_JUNCTION_CLEAR) {
    freewayDistance = NO_ROAD_DISTANCE;
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

/** Everything keyed by seed or by config-derived objects is stale across an init. */
export const clearCityCaches = (): void => {
  clearCityCellCaches();
  clearCityDistrictCaches();
  cityElevationCache.clear();
  cityElevationCacheSeed = "";
};
