/**
 * Shared vertex data computation module.
 * Imported by both terrain.worker.ts and spawn.worker.ts.
 *
 * Inlines: noise FBM, voronoi grid/Delaunay/walls/distance,
 * biome height functions, city grid logic.
 */

import Delaunator from "delaunator";
import Noise from "noise-ts";
import { seedRand, smoothstep } from "../math/_math";
import { CITY_BIOME_ID } from "../../world/constants";
import { densityCellRange, densityCellSize, densityProbability, passesPlacementFilters, rollDensityCell } from "./densityPlacement";

// The deterministic roll every worker uses — one implementation (utils/math).
export { seedRand };

// ══════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════

export interface TerrainNoiseParams {
  type: "simplex" | "perlin";
  octaves: number;
  persistence: number;
  lacunarity: number;
  exponentiation: number;
  height: number;
  scale: number;
}

export interface SerializedRegion {
  id: number;
  name: string;
  biomes: SerializedBiome[];
}

export interface SerializedBiome {
  id: number;
  name: string;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}

export interface DomainConfig {
  seed: string;
  regions: SerializedRegion[];
  gridSize: number;
  regionGridSize: number;
  boundaryWidth: number;
  riverWidth: number;
  defaultBlendWidth: number;
  roadNoiseParams: TerrainNoiseParams;
  baseNoiseParams: TerrainNoiseParams;
  biomeNoiseConfigs: {
    [biomeId: number]: {
      params: TerrainNoiseParams;
      absNeg?: boolean;
      scale?: number;
      offset?: number;
    };
  };
  cityConfig: {
    seed: string;
    gridSize: number; // block grid cell size
    roadWidth: number; // street half-width: road centerline (block boundary) → curb
    blockCount: number;
    maxBlockElevation: number; // per-block plateau height range [0, max]
    curbHeight: number; // road surface depth below the sidewalk
    freewayWidth: number; // arterial (district boundary road) half-width
    districtSize: number; // average district size in CELLS (sections of rotated grid)
    triangleChance: number; // probability a super-cell is split by a diagonal road
    roundaboutChance: number; // probability a super-cell is a circular block + ring road
  };
  /** Actors with flattenGround: true — the terrain flattens a PAD under each
   *  deterministic instance (see the flatten-pad engine below). */
  flattenDescriptors?: FlattenDescriptor[];
}

/** Serialized placement rules of a flattenGround actor — enough to replicate
 *  its spawn candidates deterministically inside the height function. */
export interface FlattenDescriptor {
  id: string;
  density: number;
  clustering: number;
  footprint: number;
  priority: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  roadDistanceRange?: [number, number];
  radius: number; // flat pad radius around the instance
  skirt: number; // blend ring width back to the raw terrain
}

export interface VertexResult {
  height: number;
  biomeId: number;
  blend: number;
  distanceToBiomeBoundaryCenter: number;
  distanceToRiverCenter: number;
  distanceToRoadCenter: number;
  /** REAL distance to the nearest freeway centerline (arterial edge or the
   *  belt ring) — 99999 outside the city and in junction zones. Drives the
   *  freeway lane paint. */
  distanceToFreewayCenter: number;
  /** Coordinate ALONG that freeway (axis coordinate for arterials, wall
   *  projection for the belt) — the lane-paint dash phase. 0 outside. */
  freewayAlong: number;
}

// Internal types
interface Vec2 {
  x: number;
  y: number;
}
interface Wall {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}
interface VGrid {
  point: Vec2;
  element: any;
}

// ══════════════════════════════════════════════════════════════════════
// Noise
// ══════════════════════════════════════════════════════════════════════

const noiseInstance = new Noise(seedRand("bierce"));

const simplex2 = (x: number, y: number) => noiseInstance.simplex2(x, y);
const perlin2 = (x: number, y: number) => noiseInstance.perlin2(x, y);

// Per-params constants (gain + normalization depend only on the params
// object, which is stable per world config) — recomputing 2**-persistence and
// the amplitude sum per call added a pow per noise call, 3-4 calls per vertex.
const noiseParamsCache = new WeakMap<TerrainNoiseParams, { G: number; norm: number }>();
const getNoiseConsts = (params: TerrainNoiseParams) => {
  let c = noiseParamsCache.get(params);
  if (!c) {
    const G = 2.0 ** -params.persistence;
    let amplitude = 1.0;
    let norm = 0;
    for (let o = 0; o < params.octaves; o++) {
      norm += amplitude;
      amplitude *= G;
    }
    c = { G, norm };
    noiseParamsCache.set(params, c);
  }
  return c;
};

const terrainNoise = (params: TerrainNoiseParams, x: number, y: number): number => {
  const xs = x / params.scale;
  const ys = y / params.scale;
  const { G, norm } = getNoiseConsts(params);
  const isSimplex = params.type === "simplex";
  let amplitude = 1.0;
  let frequency = 1.0;
  let total = 0;
  for (let o = 0; o < params.octaves; o++) {
    const noiseValue =
      (isSimplex ? simplex2(xs * frequency, ys * frequency) : perlin2(xs * frequency, ys * frequency)) *
        0.5 +
      0.5;
    total += noiseValue * amplitude;
    amplitude *= G;
    frequency *= params.lacunarity;
  }
  total /= norm;
  total -= 0.5;
  // pow() preserved exactly for arbitrary exponents; the common integer cases
  // skip it (identical results — pow with integer exponents is exact here)
  const e = params.exponentiation;
  const shaped = e === 2 ? total * total : e === 1 ? total : Math.pow(total, e);
  return shaped * params.height;
};

// ══════════════════════════════════════════════════════════════════════
// Voronoi (inlined from voronoi.worker.ts)
// ══════════════════════════════════════════════════════════════════════

// Caches keyed by seed string
const voronoiCaches: { [seed: string]: { [gridKey: string]: any } } = {};

const getVoronoiGrid = (
  seed: string,
  currentVertex: Vec2,
  cellArray: any[],
  gridSize: number,
  gridFunction: (point: Vec2, array: any[]) => any
): VGrid[] => {
  const x = Math.floor(currentVertex.x / gridSize);
  const y = Math.floor(currentVertex.y / gridSize);

  if (!voronoiCaches[seed]) voronoiCaches[seed] = {};
  const cache = voronoiCaches[seed];
  const gridKey = `${x},${y}`;

  let grid: VGrid[] = cache[gridKey];
  if (!grid) {
    grid = [];
    for (let ix = x - 2; ix <= x + 2; ix++) {
      for (let iy = y - 2; iy <= y + 2; iy++) {
        const px = seedRand(`${seed} - ${ix}X${iy}`);
        const py = seedRand(`${seed} - ${ix}Y${iy}`);
        const point: Vec2 = { x: (ix + px) * gridSize, y: (iy + py) * gridSize };
        const element = gridFunction(point, cellArray);
        grid.push({ point, element });
      }
    }
    cache[gridKey] = grid;

    // Evict distant entries
    for (const key in cache) {
      const [cx, cy] = key.split(",").map(Number);
      if (Math.abs(x - cx) > 5 || Math.abs(y - cy) > 5) {
        delete cache[key];
      }
    }
  }
  return grid;
};

const getNearestEntry = (point: Vec2, grid: VGrid[]): VGrid => {
  let minDist = Infinity;
  let nearest = grid[0];
  for (let i = 0; i < grid.length; i++) {
    const dx = point.x - grid[i].point.x;
    const dy = point.y - grid[i].point.y;
    const d = dx * dx + dy * dy;
    if (d < minDist) {
      minDist = d;
      nearest = grid[i];
    }
  }
  return nearest;
};

const getTwoNearest = (px: number, py: number, grid: VGrid[]): [VGrid, VGrid] => {
  let min1 = Infinity;
  let min2 = Infinity;
  let idx1 = 0;
  let idx2 = 1;
  for (let i = 0; i < grid.length; i++) {
    const dx = px - grid[i].point.x;
    const dy = py - grid[i].point.y;
    const d = dx * dx + dy * dy;
    if (d < min1) {
      min2 = min1;
      idx2 = idx1;
      min1 = d;
      idx1 = i;
    } else if (d < min2) {
      min2 = d;
      idx2 = i;
    }
  }
  return [grid[idx1], grid[idx2]];
};

// Delaunay cache (keyed by grid array reference)
const delaunayCache = new WeakMap<
  VGrid[],
  { delaunay: Delaunator<ArrayLike<number>>; circumcenters: number[] }
>();

const getDelaunayData = (grid: VGrid[]) => {
  let cached = delaunayCache.get(grid);
  if (cached) return cached;

  const coords = new Float64Array(grid.length * 2);
  for (let i = 0; i < grid.length; i++) {
    coords[i * 2] = grid[i].point.x;
    coords[i * 2 + 1] = grid[i].point.y;
  }
  const delaunay = new Delaunator(coords);

  const circumcenters: number[] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const ai = delaunay.triangles[i];
    const bi = delaunay.triangles[i + 1];
    const ci = delaunay.triangles[i + 2];
    const ax = grid[ai].point.x,
      ay = grid[ai].point.y;
    const bx = grid[bi].point.x,
      by = grid[bi].point.y;
    const cx = grid[ci].point.x,
      cy = grid[ci].point.y;

    const ad = ax * ax + ay * ay;
    const bd = bx * bx + by * by;
    const cd = cx * cx + cy * cy;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    circumcenters.push(
      (1 / D) * (ad * (by - cy) + bd * (cy - ay) + cd * (ay - by)),
      (1 / D) * (ad * (cx - bx) + bd * (ax - cx) + cd * (bx - ax))
    );
  }

  cached = { delaunay, circumcenters };
  delaunayCache.set(grid, cached);
  return cached;
};

// Wall lists are a pure function of the two grid arrays (the vertex only
// feeds eviction bookkeeping), so memoize on grid identity like the Delaunay
// cache. Without this, every vertex re-walked all ~96 halfedges and allocated
// a label string per halfedge + a Wall object per boundary — ~900k string
// allocations per LOD1 chunk, the dominant chunk-build cost. The regionGrid
// identity is checked too: a biome grid cell always maps to one region grid
// (gridSize divides regionGridSize), but the guard keeps the cache correct
// even if that invariant ever changes.
const wallsCache = new WeakMap<
  VGrid[],
  { regionGrid: VGrid[]; biomeWalls: Wall[]; riverWalls: Wall[] }
>();

const getWalls = (
  seed: string,
  currentVertex: Vec2,
  grid: VGrid[],
  regionGrid: VGrid[],
  gridSize: number
): { biomeWalls: Wall[]; riverWalls: Wall[] } => {
  const memo = wallsCache.get(grid);
  if (memo && memo.regionGrid === regionGrid) return memo;

  const x = Math.floor(currentVertex.x / gridSize);
  const y = Math.floor(currentVertex.y / gridSize);

  const wallSeed = `${seed} - walls`;
  if (!voronoiCaches[wallSeed]) voronoiCaches[wallSeed] = {};
  const cache = voronoiCaches[wallSeed];

  const { delaunay, circumcenters } = getDelaunayData(grid);

  const biomeWalls: Wall[] = [];
  const riverWalls: Wall[] = [];

  for (let i = 0; i < delaunay.halfedges.length; i++) {
    const edge = delaunay.halfedges[i];
    if (edge === -1) continue;

    const t1 = Math.floor(i / 3);
    const t2 = Math.floor(edge / 3);
    const v1x = circumcenters[t1 * 2],
      v1y = circumcenters[t1 * 2 + 1];
    const v2x = circumcenters[t2 * 2],
      v2y = circumcenters[t2 * 2 + 1];

    const midX = (v1x + v2x) / 2;
    const midY = (v1y + v2y) / 2;
    const label = `${Math.floor(midX)},${Math.floor(midY)}`;

    if (cache[label] === undefined) {
      const [nearest1, nearest2] = getTwoNearest(midX, midY, grid);
      const region1 = getNearestEntry(nearest1.point, regionGrid)?.element;
      const region2 = getNearestEntry(nearest2.point, regionGrid)?.element;

      cache[label] = {
        grid: [x, y],
        isRegionBoundary: region1 !== region2,
        isBiomeBoundary: !nearest1.element.joinable || nearest1.element !== nearest2.element,
      };

      // Evict distant entries
      for (const key in cache) {
        const cachedData = cache[key];
        if (cachedData.grid) {
          const [cx, cy] = cachedData.grid;
          if (Math.abs(x - cx) > 5 || Math.abs(y - cy) > 5) {
            delete cache[key];
          }
        }
      }
    }

    const wall: Wall = { sx: v1x, sy: v1y, ex: v2x, ey: v2y };

    if (cache[label].isRegionBoundary) {
      riverWalls.push(wall);
      biomeWalls.push(wall);
    } else if (cache[label].isBiomeBoundary) {
      biomeWalls.push(wall);
    }
  }

  const result = { regionGrid, biomeWalls, riverWalls };
  wallsCache.set(grid, result);
  return result;
};

/** Side-channel of the last distanceToWall call: a pseudo-arc coordinate
 *  along the WINNING wall (projection distance + a per-segment phase from
 *  the segment's start point). Continuous within a segment; jumps at wall
 *  joints — used for the belt freeway's dash phase (the shader's fwidth
 *  guard drops the paint over the jump slivers). */
let lastWallAlong = 0;

const distanceToWall = (px: number, py: number, walls: Wall[]): number => {
  let minDistSq = Infinity;
  lastWallAlong = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dy = w.ey - w.sy;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (py - w.sy) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cy = w.sy + t * dy;
    const ddx = px - cx, ddy = py - cy;
    const distSq = ddx * ddx + ddy * ddy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      lastWallAlong = t * Math.sqrt(lenSq) + w.sx + w.sy;
    }
  }
  return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
};

// ══════════════════════════════════════════════════════════════════════
// City (block grid + triangle/roundabout cells + axis-aligned freeways)
// ══════════════════════════════════════════════════════════════════════

/** Plateau height of a block index (edge blocks sit at 0). Keyed by index so
 *  adjacent cells of the same block — which have no road between them — are
 *  guaranteed the same height. Memoized: it runs 4× per city vertex and
 *  seedRand spins up a fresh seedrandom instance per call. */
const cityElevationCache = new Map<number, number>();
let cityElevationCacheSeed = "";
const cityBlockElevation = (
  citySeed: string,
  blockIndex: number | undefined,
  maxElevation: number
): number => {
  if (blockIndex === undefined || blockIndex < 0) return 0;
  // Numeric memo key — the seeded string is only built on a genuine miss
  // (this runs 4-5× per city vertex; the old string key allocated per HIT)
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

interface CityTerrain {
  dist: number; // distance to the nearest road centerline, in street units (0 = on it)
  elevation: number; // height RELATIVE to the smooth base: plateau + road ramps +
  //   curb dip (computeVertexData adds the base back). Flat footing for
  //   buildings comes from the generic flatten-ground PADS, not from leveling
  //   blocks (whole-block leveling was tried and REVERTED in favor of pads —
  //   pads work in every biome).
  paintDist: number; // REAL distance to the nearest freeway centerline (paint channel)
  paintAlong: number; // dash-phase coordinate along that freeway
}

// Ramps between block plateaus extend this far BEYOND the road half-width on
// each side (across the sidewalk) — the wide span keeps street grades gentle.
const CITY_RAMP_SPAN = 4;

// Scale of the pairwise chamfer/melt constraint: road-edge along the cut
// sits at dᵢ + dⱼ = roadWidth / scale (≈ 28.6u span at 0.35) — corners get
// straight diagonal cuts and thinner pinched fragments become road entirely.
const CITY_CHAMFER_SCALE = 0.35;

// A pair only chamfers when the two toward-road directions genuinely differ:
// inside a corner wedge or a pinch they are ≥ 90° apart (dot ≤ 0), while a
// road event ACROSS the street (T-junction stem, far-side bend) points the
// same way as the near road (dot ≈ +1) and must not notch this block's edge.
// The penalty fades in smoothly over the dot range so the field stays
// continuous.
const CITY_CHAMFER_DOT_LO = 0.6;
const CITY_CHAMFER_DOT_HI = 0.85;
const CITY_CHAMFER_DOT_PENALTY = 60;

// Arterial field recovery: the ×(roadWidth/freewayWidth) squash applies only
// up to this NORMALIZED value (just past the interior-band start at 12, so
// the stretched freeway bands render untouched); beyond it the field climbs
// at the steep slope, letting buildings spawn at a near-normal setback from
// the freeway curb instead of ~11×roadWidth away.
const CITY_ARTERIAL_RECOVER_NORM = 12.2;
const CITY_ARTERIAL_RECOVER_SLOPE = 3;

// Freeway grade ramp end (real units from the freeway centerline): plateaus
// reach their full height this far out. Must stay well inside the building
// setback (~35u from the centerline via the field recovery) so block
// interiors are flat where buildings stand.
const CITY_FREEWAY_RAMP_END = 24;

// Constraint candidates: distance + toward-road unit direction (world frame).
// Scratch buffers — workers are single-threaded.
const cityConsD = new Float64Array(24);
const cityConsUx = new Float64Array(24);
const cityConsUz = new Float64Array(24);

// ── Cell shapes ──
// Every road feature is CONFINED to its own cell (nothing crosses blocks),
// which is what guarantees no tiny leftover pieces: a feature can only carve
// its own cell, in grid-aligned ways.
const CITY_SHAPE_SQUARE = 0;
const CITY_SHAPE_TRI_NE = 1; // diagonal road from the SW corner to the NE corner
const CITY_SHAPE_TRI_NW = 2; // diagonal road from the NW corner to the SE corner
const CITY_SHAPE_CIRCLE = 3; // circular block inside a roundabout ring road

// Roundabout ring-road centerline radius (× gridSize). Roundabouts span a
// 2×2 super-cell (they replace FOUR normal blocks); the ring is centered on
// the super-cell, so ring + road must fit its half-size: frac + roadWidth/gs < 1.
const CITY_RING_RADIUS_FRAC = 0.825;

interface CityCell {
  /** Block index in [0, blockCount) for squares (same-label neighbors merge),
   *  a unique per-cell id (≥1000) for triangle/circle cells so they are
   *  always ringed by boundary roads, or -1 near the biome wall (whole cell
   *  = the rim ring road, plateau 0). */
  label: number;
  shape: number;
}

/** Unique per-cell label for triangle/circle cells. Collisions between two
 *  adjacent special cells would only merge their boundary road — harmless. */
const cityUniqueLabel = (ix: number, iy: number): number =>
  1000 + ((((ix * 73856093) ^ (iy * 19349663)) >>> 0) % 1000000);

/** A 2×2 super-cell only hosts a shape feature (roundabout / flatiron pair)
 *  when the WHOLE super-cell is clear of the biome rim and of the district's
 *  arterial boundaries — a half circle or clipped diagonal at a boundary is
 *  worse than no feature. Coordinates are district-local. */
const superCellHasRoom = (sx: number, sy: number, walls: Wall[], d: CityDistrict): boolean => {
  const city = cfg!.cityConfig;
  const gs = city.gridSize;
  const w = cityLocalToWorld((2 * sx + 1) * gs, (2 * sy + 1) * gs, d);
  // Covers every member cell's own rim check (cell centers sit ≤ 0.71·gs from
  // the super center; cells go rim under 0.65·gs) plus breathing room.
  if (distanceToWall(w.x, w.y, walls) < gs * 1.6) return false;
  // Arterial clearance: rotated super-cell extent (√2·gs) + arterial road,
  // measured against the actual wiggly boundary curves.
  return cityArterialDist(w.x, w.y, d) >= gs * 1.7;
};

/** Label a cell would get if it is NOT a roundabout member (rim −1,
 *  triangle unique, or square roll) — null when the cell IS a roundabout
 *  member. Lets roundabout members COPY an outward neighbor's label without
 *  recursion. Coordinates are district-local; seeds are salted by district. */
const baseCityLabel = (ix: number, iy: number, walls: Wall[], d: CityDistrict): number | null => {
  const city = cfg!.cityConfig;
  const gs = city.gridSize;
  const px = (ix + 0.5) * gs;
  const py = (iy + 0.5) * gs;
  const w = cityLocalToWorld(px, py, d);
  if (distanceToWall(w.x, w.y, walls) < gs * 0.15) return -1;
  const sx = Math.floor(ix / 2);
  const sy = Math.floor(iy / 2);
  const superRoll = seedRand(`${city.seed}-super-${d.key}|${sx},${sy}`);
  if (
    superRoll < city.roundaboutChance + city.triangleChance &&
    superCellHasRoom(sx, sy, walls, d)
  ) {
    if (superRoll < city.roundaboutChance) return null;
    return cityUniqueLabel(sx, sy);
  }
  return Math.floor(seedRand(`${d.key}|${px},${py}`) * city.blockCount);
};

/** Per-cell block cell (label + shape), cached so terrain, spawns, and the
 *  road-marker enumeration always agree. Coordinates are DISTRICT-LOCAL;
 *  each district has its own seeded layout (seeds salted by district key).
 *  Nested numeric maps under the district key: the old flat string key
 *  (`${d.key}:${ix},${iy}`) allocated ~10 strings per city vertex on HITS. */
interface CityCellStore {
  count: number;
  districts: Map<string, Map<number, Map<number, CityCell>>>;
}
const cityCellCaches: { [seed: string]: CityCellStore } = {};

const cityCellLookup = (store: CityCellStore, dKey: string, ix: number, iy: number): CityCell | undefined =>
  store.districts.get(dKey)?.get(ix)?.get(iy);

const getCityCell = (ix: number, iy: number, walls: Wall[], d: CityDistrict): CityCell => {
  const city = cfg!.cityConfig;
  let store = cityCellCaches[city.seed];
  if (!store) store = cityCellCaches[city.seed] = { count: 0, districts: new Map() };
  let cell = cityCellLookup(store, d.key, ix, iy);
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
    const gs = city.gridSize;
    const px = (ix + 0.5) * gs;
    const py = (iy + 0.5) * gs;
    const w = cityLocalToWorld(px, py, d);
    // Only cells basically ON the boundary go full-road: the BELT freeway
    // now owns the rim zone (it melts any block it clips), so blocks run
    // right up to the beltway instead of a wide rim plaza.
    if (distanceToWall(w.x, w.y, walls) < gs * 0.15) {
      cell = { label: -1, shape: CITY_SHAPE_SQUARE };
    } else {
      // Roundabouts AND triangles roll per 2×2 SUPER-CELL — each feature
      // replaces four normal blocks, and only spawns when the whole
      // super-cell has room (clear of the biome rim and the district's
      // arterial boundaries).
      const sx = Math.floor(ix / 2);
      const sy = Math.floor(iy / 2);
      let superRoll = seedRand(`${city.seed}-super-${d.key}|${sx},${sy}`);
      if (
        superRoll < city.roundaboutChance + city.triangleChance &&
        !superCellHasRoom(sx, sy, walls, d)
      ) {
        superRoll = 1; // not enough room — fall through to a normal square
      }
      if (superRoll < city.roundaboutChance) {
        // Roundabout members COPY an outward neighbor's label, so the
        // wrap-around corner blocks MERGE with the surrounding grid (no
        // street between them — the ring road alone separates them from the
        // island). Internal member boundaries with differing copied labels
        // become the streets radiating from the roundabout; the island
        // itself is protected in getCityTerrain (boundary constraints are
        // suppressed inside the ring, and its height is overridden flat).
        const nx = ix === 2 * sx ? 2 * sx - 1 : 2 * sx + 2; // outward x neighbor
        const ny = iy === 2 * sy ? 2 * sy - 1 : 2 * sy + 2; // outward y neighbor
        const copied = baseCityLabel(nx, iy, walls, d) ?? baseCityLabel(ix, ny, walls, d);
        cell = {
          label: copied ?? Math.floor(seedRand(`${d.key}|${px},${py}`) * city.blockCount),
          shape: CITY_SHAPE_CIRCLE,
        };
      } else if (superRoll < city.roundaboutChance + city.triangleChance) {
        // Triangles keep one unique label across the super-cell: boundary
        // streets are guaranteed, so the diagonal always ends in an
        // intersection.
        cell = {
          label: cityUniqueLabel(sx, sy),
          shape:
            seedRand(`${city.seed}-tri-${d.key}|${sx},${sy}`) < 0.5
              ? CITY_SHAPE_TRI_NE
              : CITY_SHAPE_TRI_NW,
        };
      } else {
        cell = {
          label: Math.floor(seedRand(`${d.key}|${px},${py}`) * city.blockCount),
          shape: CITY_SHAPE_SQUARE,
        };
      }
    }
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
    col.set(iy, cell);
    store.count++;
  }
  return cell;
};

// ── Districts (staggered rotated sections) ──
// The city is partitioned into large rectangular DISTRICTS: jittered rows
// ~districtSize cells tall, each row split into staggered jittered segments
// ~districtSize cells wide (per-row phase offset = the stagger). Every
// district rotates its ENTIRE block grid by a seeded multiple of 15° about
// its own center; district boundaries carry the wide ARTERIAL roads
// (freewayWidth), which also absorb the seams where differently-rotated
// grids meet.

const CITY_DISTRICT_JITTER = 0.4; // boundary jitter (× pitch): sizes ~0.6–1.4 × districtSize

const cityScalarCache = new Map<string, number>();
const cityScalar = (key: string, compute: () => number): number => {
  let v = cityScalarCache.get(key);
  if (v === undefined) {
    if (cityScalarCache.size > 8192) dropOldestHalf(cityScalarCache);
    v = compute();
    cityScalarCache.set(key, v);
  }
  return v;
};

const cityDistrictPitch = (): number => cfg!.cityConfig.districtSize * cfg!.cityConfig.gridSize;

// Row/segment boundaries are the hottest scalar lookups (the findCityRow /
// findCitySeg while-loops probe them ≥4× per vertex) — dedicated numeric-key
// maps so cache HITS allocate nothing (the seeded key strings are only built
// on a miss). Bounded by the district cache's own eviction radius in practice;
// entries are 8-byte numbers, so no explicit cap is needed.
const cityRowBoundaryCache = new Map<number, number>();
/** Z of the boundary line between district rows k−1 and k. */
const cityRowBoundary = (k: number): number => {
  let v = cityRowBoundaryCache.get(k);
  if (v === undefined) {
    const pitch = cityDistrictPitch();
    v = (k + (seedRand(`${cfg!.cityConfig.seed}-drow-${k}`) - 0.5) * CITY_DISTRICT_JITTER) * pitch;
    cityRowBoundaryCache.set(k, v);
  }
  return v;
};

const citySegBoundaryCache = new Map<number, Map<number, number>>();
/** X of the boundary line between segments m−1 and m of row r (staggered
 *  per row via a seeded phase). */
const citySegBoundary = (r: number, m: number): number => {
  let row = citySegBoundaryCache.get(r);
  if (!row) {
    row = new Map();
    citySegBoundaryCache.set(r, row);
  }
  let v = row.get(m);
  if (v === undefined) {
    const pitch = cityDistrictPitch();
    const phase = seedRand(`${cfg!.cityConfig.seed}-dphase-${r}`);
    v =
      (m + phase + (seedRand(`${cfg!.cityConfig.seed}-dseg-${r}-${m}`) - 0.5) * CITY_DISTRICT_JITTER) *
      pitch;
    row.set(m, v);
  }
  return v;
};

// Arterial wiggle: the district boundary roads bend with two seeded sine
// octaves — windy freeways instead of straight lines. District ASSIGNMENT
// follows the same curve, so the rotated-grid switch always stays buried
// under the arterial road surface.
const CITY_WIGGLE_AMP = 38;
const CITY_WIGGLE_K1 = (2 * Math.PI) / 620;
const CITY_WIGGLE_K2 = (2 * Math.PI) / 260;

const cityWigglePhase = (tag: string, which: number): number =>
  cityScalar(`wig${which}:${tag}`, () =>
    seedRand(`${cfg!.cityConfig.seed}-wig${which}-${tag}`) * Math.PI * 2
  );

const cityWiggle = (tag: string, t: number): number => {
  const p1 = cityWigglePhase(tag, 1);
  const p2 = cityWigglePhase(tag, 2);
  return (
    CITY_WIGGLE_AMP *
    (0.65 * Math.sin(t * CITY_WIGGLE_K1 + p1) + 0.35 * Math.sin(t * CITY_WIGGLE_K2 + p2))
  );
};

/** d(wiggle)/dt — the arterial tangent slope (for marker orientation). */
const cityWiggleSlope = (tag: string, t: number): number => {
  const p1 = cityWigglePhase(tag, 1);
  const p2 = cityWigglePhase(tag, 2);
  return (
    CITY_WIGGLE_AMP *
    (0.65 * CITY_WIGGLE_K1 * Math.cos(t * CITY_WIGGLE_K1 + p1) +
      0.35 * CITY_WIGGLE_K2 * Math.cos(t * CITY_WIGGLE_K2 + p2))
  );
};

/** Z of the (wiggly) arterial centerline between rows k−1 and k, at world x. */
const cityRowEdgeZ = (k: number, vx: number): number =>
  cityRowBoundary(k) + cityWiggle(`r${k}`, vx);

/** X of the (wiggly) arterial centerline between segments m−1 and m of row r, at world z. */
const citySegEdgeX = (r: number, m: number, vz: number): number =>
  citySegBoundary(r, m) + cityWiggle(`s${r}:${m}`, vz);

const findCityRow = (vz: number, vx: number): number => {
  let r = Math.floor(vz / cityDistrictPitch());
  while (vz < cityRowEdgeZ(r, vx)) r -= 1;
  while (vz >= cityRowEdgeZ(r + 1, vx)) r += 1;
  return r;
};

const findCitySeg = (r: number, vx: number, vz: number): number => {
  let m = Math.floor(vx / cityDistrictPitch() - 0.5);
  while (vx < citySegEdgeX(r, m, vz)) m -= 1;
  while (vx >= citySegEdgeX(r, m + 1, vz)) m += 1;
  return m;
};

interface CityDistrict {
  key: string;
  r: number; // row / segment indices (for the wiggly edge lookups)
  m: number;
  cos: number; // rotation: a seeded multiple of 15°
  sin: number;
  px: number; // rotation pivot (district center, world)
  py: number;
  minX: number; // district rect BASELINE (world; actual edges wiggle ±CITY_WIGGLE_AMP)
  maxX: number;
  minZ: number;
  maxZ: number;
}

const cityDistrictCache = new Map<string, CityDistrict>();
const cityDistrictByIndex = (r: number, m: number): CityDistrict => {
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
      (1 + Math.floor(seedRand(`${cfg!.cityConfig.seed}-dang-${key}`) * 5)) * (Math.PI / 12);
    d = {
      key,
      r,
      m,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      px: (minX + maxX) / 2,
      py: (minZ + maxZ) / 2,
      minX,
      maxX,
      minZ,
      maxZ,
    };
    cityDistrictCache.set(key, d);
  }
  return d;
};

const getCityDistrict = (vx: number, vz: number): CityDistrict => {
  const r = findCityRow(vz, vx);
  return cityDistrictByIndex(r, findCitySeg(r, vx, vz));
};

/** Distance from a world point to its district's wiggly arterial boundary
 *  centerlines (axis-approximate; the gentle wiggle slope keeps it close). */
const cityArterialDist = (vx: number, vz: number, d: CityDistrict): number =>
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
const cityLocalToWorld = (lx: number, ly: number, d: CityDistrict): Vec2 => {
  const dx = lx - d.px;
  const dz = ly - d.py;
  return { x: d.px + dx * d.cos - dz * d.sin, y: d.py + dx * d.sin + dz * d.cos };
};

const getCityTerrain = (
  vx: number,
  vy: number,
  city: DomainConfig["cityConfig"],
  walls: Wall[],
  biomeBoundaryDist: number,
  biomeWallAlong: number
): CityTerrain => {
  const gs = city.gridSize;

  // ── District frame ──
  // Find the vertex's district and rotate into its LOCAL grid frame (by
  // −angle about the district pivot). ALL block logic below runs in local
  // coordinates; distances/heights are rotation-invariant, so the outputs
  // need no back-transform.
  const d = getCityDistrict(vx, vy);
  const rdx = vx - d.px;
  const rdz = vy - d.py;
  const lx = d.px + rdx * d.cos + rdz * d.sin;
  const ly = d.py - rdx * d.sin + rdz * d.cos;

  const ix = Math.floor(lx / gs);
  const iy = Math.floor(ly / gs);

  // ── Block grid ──
  // Square cells labeled with a block index; neighbors that roll the same
  // index merge into larger polyomino blocks (no road between them). Streets
  // run along the boundaries of differing-label cells. Triangle and circle
  // cells carry a UNIQUE label, so they are always ringed by boundary roads —
  // their internal features (diagonal / roundabout) terminate cleanly into
  // grid intersections and can never shave a sliver off a neighbor.
  const cell = getCityCell(ix, iy, walls, d);
  const cur = cell.label;
  // 3×3 labels: L[(a+1)*3 + (b+1)] = label of cell (ix+a, iy+b). The full
  // neighborhood (not just 4 neighbors) feeds the SEGMENT constraints below.
  const L: number[] = [];
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      L[(a + 1) * 3 + (b + 1)] = getCityCell(ix + a, iy + b, walls, d).label;
    }
  }
  const n = L[5]; // (0, +1)
  const e = L[7]; // (+1, 0)
  const s = L[3]; // (0, −1)
  const w = L[1]; // (−1, 0)

  // Collect road constraints with their toward-road unit directions (world
  // frame — local directions are rotated out) for the direction-aware
  // chamfer pairing below. NaN direction = pairable with anything (rim).
  let nCons = 0;
  const considerLocal = (dd: number, lux: number, luz: number) => {
    if (nCons >= 24) return;
    cityConsD[nCons] = dd;
    cityConsUx[nCons] = lux * d.cos - luz * d.sin;
    cityConsUz[nCons] = lux * d.sin + luz * d.cos;
    nCons++;
  };
  const considerWorld = (dd: number, wux: number, wuz: number) => {
    if (nCons >= 24) return;
    cityConsD[nCons] = dd;
    cityConsUx[nCons] = wux;
    cityConsUz[nCons] = wuz;
    nCons++;
  };

  // Roundabout geometry (needed before the boundary constraints: inside the
  // ring, boundary streets are suppressed so the internal member boundaries
  // — whose copied labels usually differ — tee into the ring road instead of
  // slicing across the island; the toggle happens under the ring road
  // surface, so it is invisible).
  let circleR = Infinity;
  let ringR = 0;
  let circUx = 1; // unit direction from the ring center to the vertex (local)
  let circUz = 0;
  if (cell.shape === CITY_SHAPE_CIRCLE) {
    const scx = (2 * Math.floor(ix / 2) + 1) * gs;
    const scz = (2 * Math.floor(iy / 2) + 1) * gs;
    circleR = Math.hypot(lx - scx, ly - scz);
    ringR = gs * CITY_RING_RADIUS_FRAC;
    if (circleR > 1e-6) {
      circUx = (lx - scx) / circleR;
      circUz = (ly - scz) / circleR;
    }
  }
  const insideRing = circleR < ringR;

  if (!insideRing) {
    // Street constraints as boundary SEGMENTS over the whole 3×3 neighborhood
    // (12 segments), not per-cell infinite lines. Segments are fixed geometric
    // objects, and the ones that enter/leave the set when crossing a cell
    // border are always ≥ ~half a cell away — so the field (and especially
    // the s1+s2 chamfer, whose second constraint used to pop identity at cell
    // borders and leave jagged notches in the road edge) stays continuous.
    // Contiguous differing segments along one boundary LINE are merged into
    // single runs before being considered: a straight road along two merged
    // same-label cells is otherwise TWO collinear segments, and the s1+s2
    // chamfer would pair them — two pieces of the SAME road — undercutting
    // the field to ~70% and notching the sidewalk at every merged-block cell
    // seam. (Run truncation at the 3×3 window edge is ≥ ~half a cell from
    // any point in the current cell — beyond band/chamfer range.)
    // Vertical boundary lines (between cell columns a and a+1):
    for (let a = -1; a <= 0; a++) {
      const X = (ix + a + 1) * gs;
      let runStart = 99;
      for (let b = -1; b <= 2; b++) {
        const differs = b <= 1 && L[(a + 1) * 3 + (b + 1)] !== L[(a + 2) * 3 + (b + 1)];
        if (differs && runStart === 99) runStart = b;
        if (!differs && runStart !== 99) {
          const z0 = (iy + runStart) * gs;
          const z1 = (iy + b) * gs;
          const ddx = X - lx;
          const ddz = ly < z0 ? z0 - ly : ly > z1 ? z1 - ly : 0;
          const dd = Math.hypot(ddx, ddz);
          if (dd < 1e-6) considerLocal(0, 1, 0);
          else considerLocal(dd, ddx / dd, ddz / dd);
          runStart = 99;
        }
      }
    }
    // Horizontal boundary lines (between cell rows b and b+1):
    for (let b = -1; b <= 0; b++) {
      const Z = (iy + b + 1) * gs;
      let runStart = 99;
      for (let a = -1; a <= 2; a++) {
        const differs = a <= 1 && L[(a + 1) * 3 + (b + 1)] !== L[(a + 1) * 3 + (b + 2)];
        if (differs && runStart === 99) runStart = a;
        if (!differs && runStart !== 99) {
          const x0 = (ix + runStart) * gs;
          const x1 = (ix + a) * gs;
          const ddz = Z - ly;
          const ddx = lx < x0 ? x0 - lx : lx > x1 ? x1 - lx : 0;
          const dd = Math.hypot(ddx, ddz);
          if (dd < 1e-6) considerLocal(0, 0, 1);
          else considerLocal(dd, ddx / dd, ddz / dd);
          runStart = 99;
        }
      }
    }
  }

  // In-super-cell shape features (each confined to its own 2×2 super-cell):
  if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
    // Diagonal road corner-to-corner across the SUPER-CELL: splits the 2×2
    // area into two large flatiron halves. Its unique label guarantees
    // boundary streets, so the diagonal always ends in an intersection.
    const dx = lx - 2 * Math.floor(ix / 2) * gs;
    const dz = ly - 2 * Math.floor(iy / 2) * gs;
    if (cell.shape === CITY_SHAPE_TRI_NE) {
      // Line x − z = 0 (super-local); gradient (√½, −√½)
      const sig = (dx - dz) * Math.SQRT1_2;
      const f = sig >= 0 ? -1 : 1; // toward the line = −sign · gradient
      considerLocal(Math.abs(sig), f * Math.SQRT1_2, -f * Math.SQRT1_2);
    } else {
      // Line x + z = 2·gs (super-local); gradient (√½, √½)
      const sig = (dx + dz - 2 * gs) * Math.SQRT1_2;
      const f = sig >= 0 ? -1 : 1;
      considerLocal(Math.abs(sig), f * Math.SQRT1_2, f * Math.SQRT1_2);
    }
  } else if (cell.shape === CITY_SHAPE_CIRCLE) {
    // Roundabout ring road: outside the ring, the wrap-around blocks (labels
    // copied from the surrounding grid) run right up to it — only the ring
    // road separates them from the island. The island's field is compressed
    // (× 0.75) so spawned buildings keep a safe margin from the curved curb.
    if (insideRing) considerLocal((ringR - circleR) * 0.75, circUx, circUz);
    else considerLocal(circleR - ringR, -circUx, -circUz);
  }

  // Arterials: the wide roads along the district boundaries (WORLD-aligned —
  // the partition itself is not rotated, only each district's interior grid).
  // They also absorb the seams between differently-rotated grids: near the
  // boundary everything is arterial road, so the frame switch is invisible.
  // Distances are normalized into street units so the ONE road field drives
  // the shader bands, curb dip, and spawn filters everywhere — arterial
  // features just render stretched by freewayWidth / roadWidth.
  const fwScale = city.roadWidth / city.freewayWidth;
  const aS = vy - cityRowEdgeZ(d.r, vx);
  const aN = cityRowEdgeZ(d.r + 1, vx) - vy;
  const aW = vx - citySegEdgeX(d.r, d.m, vy);
  const aE = citySegEdgeX(d.r, d.m + 1, vy) - vx;
  let arterialReal = aS;
  let aUx = 0;
  let aUz = -1;
  let arterialAlong = vx; // row boundaries run along x
  if (aN < arterialReal) {
    arterialReal = aN;
    aUx = 0;
    aUz = 1;
    arterialAlong = vx;
  }
  if (aW < arterialReal) {
    arterialReal = aW;
    aUx = -1;
    aUz = 0;
    arterialAlong = vy; // segment boundaries run along z
  }
  if (aE < arterialReal) {
    arterialReal = aE;
    aUx = 1;
    aUz = 0;
    arterialAlong = vy;
  }
  arterialReal = Math.max(0, arterialReal);
  // Normalized (× roadWidth/freewayWidth) through the visual bands so the
  // shader renders the arterial as a stretched street, then RECOVERING
  // steeply just past the interior-band edge (max() of the two slopes keeps
  // the field continuous; the bands themselves are untouched). Without the
  // recovery, the squash held the field under the building-spawn threshold
  // for ~11×roadWidth real units, leaving the blocks along every arterial
  // empty — with the steep recovery, buildings reach a near-normal setback
  // from the freeway curb.
  const recoverNorm = CITY_ARTERIAL_RECOVER_NORM;
  considerWorld(
    Math.max(
      arterialReal * fwScale,
      (arterialReal - recoverNorm / fwScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm
    ),
    aUx,
    aUz
  );

  // BELT freeway: the city rim is a freeway RING surrounding the whole biome
  // — the arterials running outward empty into it. Its centerline sits
  // boundaryWidth + freewayWidth inside the biome boundary, so the belt's
  // outer road edge exactly abuts the boundary band. Same normalization +
  // spawn recovery as arterials; blocks melt/chamfer against the curved belt
  // like against any road. No direction is available (the boundary curves),
  // so it pairs with anything in the chamfer.
  const beltReal = Math.abs(biomeBoundaryDist - (cfg!.boundaryWidth + city.freewayWidth));
  considerWorld(
    Math.max(
      beltReal * fwScale,
      (beltReal - recoverNorm / fwScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm
    ),
    NaN,
    0
  );

  // ── Plateau elevation ──
  // Bilinear plateau interpolation toward the neighbors the vertex leans
  // into: ramping only where labels differ (same label → same height → no
  // seam). Heights are RELATIVE to the regional base, which the whole city
  // rides smoothly; flat building footing comes from the flatten-ground
  // PADS, not from leveling blocks. The ramp span covers street AND
  // sidewalk (roadWidth + CITY_RAMP_SPAN each side) for gentle grades.
  const rampFrac = (city.roadWidth + CITY_RAMP_SPAN) / gs;
  const flatEdge = 0.5 - rampFrac;
  const fx = lx / gs - (ix + 0.5); // [-0.5, 0.5] across the cell
  const fy = ly / gs - (iy + 0.5);
  const wx = 0.5 * smoothstep(flatEdge, 0.5, Math.abs(fx));
  const wy = 0.5 * smoothstep(flatEdge, 0.5, Math.abs(fy));
  const dxi = fx >= 0 ? 1 : -1;
  const dyi = fy >= 0 ? 1 : -1;
  const hC = cityBlockElevation(city.seed, cur, city.maxBlockElevation);
  const hX = cityBlockElevation(city.seed, fx >= 0 ? e : w, city.maxBlockElevation);
  const hY = cityBlockElevation(city.seed, fy >= 0 ? n : s, city.maxBlockElevation);
  const hD = cityBlockElevation(
    city.seed,
    getCityCell(ix + dxi, iy + dyi, walls, d).label,
    city.maxBlockElevation
  );
  let elevation =
    hC * (1 - wx) * (1 - wy) + hX * wx * (1 - wy) + hY * (1 - wx) * wy + hD * wx * wy;

  // Freeways (arterials + belt) sit at MID-PLATEAU GRADE (maxBlockElevation/2
  // — the expected value of the seeded plateaus), and the transition spreads
  // over CITY_FREEWAY_RAMP_END real units instead of hugging the centerline.
  // Both sides of a boundary still ramp to the same constant, so elevation
  // stays continuous across the district (and rotation) switch. (Grade 0 with
  // a tight ramp was used before and REJECTED: every freeway read as a V
  // TROUGH — high plateaus on both sides diving to zero along the median.
  // Mid-plateau grade halves the worst offset and turns low-plateau sides
  // into a gentle road crown.)
  const freewayGrade = city.maxBlockElevation * 0.5;
  const freewayRamp =
    smoothstep(2, CITY_FREEWAY_RAMP_END, arterialReal) *
    smoothstep(2, CITY_FREEWAY_RAMP_END, beltReal);
  elevation = freewayGrade + (elevation - freewayGrade) * freewayRamp;

  // Roundabout island: its own flat plateau, independent of the (possibly
  // differing) wrap-around block heights — blended in UNDER the inner ring
  // road surface so the transition is hidden by asphalt.
  if (insideRing) {
    const islandH = cityBlockElevation(
      city.seed,
      cityUniqueLabel(Math.floor(ix / 2), Math.floor(iy / 2)),
      city.maxBlockElevation
    );
    const islandMask = 1 - smoothstep(ringR - 12, ringR - 2, circleR);
    elevation += (islandH - elevation) * islandMask;
  }

  // Corner chamfer + sliver melt over ALL constraint PAIRS as LINEAR terms:
  // (dᵢ + dⱼ) is constant along straight lines (a 45° cut for perpendicular
  // roads), so min-ing it into the road field keeps every contour dead
  // straight — block corners at intersections get crisp diagonal cuts, and
  // fragments pinched under ~(roadWidth / scale) span become road entirely.
  // Each pair carries a smooth direction PENALTY: inside a corner wedge or a
  // pinch the two toward-road directions are ≥ 90° apart (dot ≤ 0, no
  // penalty), while a road event ACROSS the street (T-junction stem, far-side
  // bend, the far edge of the same corridor) points the same way (dot ≈ +1)
  // and must not notch this block's edge. Fully pairwise (not "s1 vs s2") so
  // no argmin identity switches — the field stays continuous. (A
  // smoothstep-SCALED melt was tried first and REJECTED: multiplying the
  // field bends band contours, rounding every block into a blob.)
  let s1 = 99;
  for (let i = 0; i < nCons; i++) if (cityConsD[i] < s1) s1 = cityConsD[i];
  let chamfer = 99;
  for (let i = 0; i < nCons; i++) {
    for (let j = i + 1; j < nCons; j++) {
      let pen = 0;
      if (!Number.isNaN(cityConsUx[i]) && !Number.isNaN(cityConsUx[j])) {
        const dot = cityConsUx[i] * cityConsUx[j] + cityConsUz[i] * cityConsUz[j];
        pen = CITY_CHAMFER_DOT_PENALTY * smoothstep(CITY_CHAMFER_DOT_LO, CITY_CHAMFER_DOT_HI, dot);
      }
      const c = (cityConsD[i] + cityConsD[j] + pen) * CITY_CHAMFER_SCALE;
      if (c < chamfer) chamfer = c;
    }
  }
  let dist = Math.min(s1, chamfer);

  if (cur < 0) dist = 0; // biome-edge cells are all road (the rim ring road)

  // Curb: the road surface sits a step below the sidewalk.
  elevation -= city.curbHeight * (1 - smoothstep(city.roadWidth - 2, city.roadWidth, dist));

  // Lane-paint channels: distance to the NEAREST freeway centerline
  // (arterial edge or belt) + the dash-phase coordinate along it (axis
  // coordinate for arterials; biome-wall projection for the belt — its
  // per-segment phase seams are dropped by the shader's fwidth guard).
  // JUNCTION ZONES — anywhere a second freeway feature is within reach
  // (arterial corners, tees into the belt, merges) — export "no paint", so
  // lines end cleanly before interchanges instead of wandering across them.
  let paintDist = arterialReal;
  let paintAlong = arterialAlong;
  if (beltReal < paintDist) {
    paintDist = beltReal;
    paintAlong = biomeWallAlong;
  }
  let m1 = 99999;
  let m2 = 99999;
  for (const v of [Math.max(0, aS), Math.max(0, aN), Math.max(0, aW), Math.max(0, aE), beltReal]) {
    if (v < m1) {
      m2 = m1;
      m1 = v;
    } else if (v < m2) {
      m2 = v;
    }
  }
  if (m2 < city.freewayWidth + 10) {
    paintDist = 99999;
    paintAlong = 0;
  }

  return { dist, elevation, paintDist, paintAlong };
};

// ══════════════════════════════════════════════════════════════════════
// Flatten-ground pads (actors with flattenGround: true)
// ══════════════════════════════════════════════════════════════════════
// Buildings — and future houses in ANY biome — need flat footing without
// biome-specific terrain hacks: each flatten-enabled actor gets a terrain
// PAD, flat at the actor's raw ground height inside `radius` and blending
// back to the raw terrain over `skirt`.
//
// The chicken-and-egg (spawn points come from terrain height; terrain now
// depends on spawn points) is resolved by making flatten-actor placement
// FULLY DETERMINISTIC and having BOTH consumers use this one function:
//   - candidates roll the exact same seeds/filters as spawn.worker's
//     density algorithm (filters evaluate against the RAW, pad-free height —
//     guarded against recursion);
//   - spacing is a stateless greedy over a CANONICAL TILE window (all
//     flatten descriptors together, ordered by priority → descriptor → cell,
//     candidate rejected within its own footprint of any accepted point) —
//     NOT the spawn worker's stateful spatial hash, which is chunk-visit-
//     order dependent and unreproducible here;
//   - spawn.worker sources these actors' points FROM getFlattenPoints, so
//     every spawned instance sits exactly on a pad, and there are no vacant
//     pads.

const FLATTEN_TILE = 128; // world units per canonical placement tile
// Spacing rounds: 1 round = Matérn II (~45% of greedy packing); 4 rounds
// converge to greedy-level density while staying window-consistent.
const FLATTEN_SPACING_ROUNDS = 4;

interface FlattenCandidate {
  x: number;
  z: number;
  y: number;
  biomeId: number;
  descIndex: number;
  gx: number;
  gz: number;
}

export interface FlattenPoint {
  x: number;
  z: number;
  y: number; // raw ground height at the center = the pad height
  biomeId: number;
  descId: string;
  radius: number;
  skirt: number;
}

/** Overflow eviction for the hot Maps: drop the OLDEST half (Maps iterate in
 *  insertion order, so recency ≈ proximity to the player). A full clear() was
 *  a cliff — for flattenTileCache each entry is hundreds of raw
 *  computeVertexData calls (30–70ms), and clearing rebuilt the entire live
 *  working set from zero on the very next vertex. */
const dropOldestHalf = <K, V>(map: Map<K, V>): void => {
  let remaining = map.size >> 1;
  for (const key of map.keys()) {
    if (remaining-- <= 0) break;
    map.delete(key);
  }
};

const flattenTileCache = new Map<string, FlattenPoint[]>();
// Adjacent tiles' padded windows overlap by the spacing pad — the boundary
// cells' candidates (each costing a RAW computeVertexData) would otherwise be
// re-evaluated for every neighboring tile (~2.2× duplication at city
// densities). null = rolled/filtered out.
const flattenCandCache = new Map<string, FlattenCandidate | null>();
let flattenReach = 0; // max(radius + skirt) — vertex lookup reach
let flattenSpacingPad = 0; // max footprint — spacing window pad
let flattenBiomes: Set<number> | null = null; // union of descs' biomeIds; null = unrestricted
let computingFlatten = false; // recursion guard: candidate filters use RAW height

/** Vertex data WITHOUT flatten pads — for sparse scans (tests, probes) that
 *  would otherwise trigger a full pad-tile computation per lonely sample. */
export function computeVertexDataRaw(x: number, z: number): VertexResult {
  computingFlatten = true;
  try {
    return computeVertexData(x, z);
  } finally {
    computingFlatten = false;
  }
}

/** All accepted flatten points whose CENTER lies in the given tile.
 *  Canonical: candidates are gathered over the tile padded by the max
 *  footprint and greedily spaced in a fixed order, so every caller (terrain
 *  vertices, spawn worker, tests) sees the identical set. */
const flattenTilePoints = (tx: number, tz: number): FlattenPoint[] => {
  const key = `${tx},${tz}`;
  const hit = flattenTileCache.get(key);
  if (hit) return hit;
  if (flattenTileCache.size > 2048) dropOldestHalf(flattenTileCache);

  const minX = tx * FLATTEN_TILE;
  const minZ = tz * FLATTEN_TILE;
  const maxX = minX + FLATTEN_TILE;
  const maxZ = minZ + FLATTEN_TILE;
  const pMinX = minX - flattenSpacingPad;
  const pMinZ = minZ - flattenSpacingPad;
  const pMaxX = maxX + flattenSpacingPad;
  const pMaxZ = maxZ + flattenSpacingPad;

  const descs = cfg!.flattenDescriptors!;
  const candidates: FlattenCandidate[] = [];
  computingFlatten = true;
  try {
    for (let di = 0; di < descs.length; di++) {
      const desc = descs[di];
      // EXACTLY the spawn.worker density algorithm (same seeds, same filters —
      // both call the shared densityPlacement helpers), minus the stateful
      // spacing hash.
      const cellSize = densityCellSize(desc.density);
      const [gx0, gx1] = densityCellRange(pMinX, pMaxX, cellSize);
      const [gz0, gz1] = densityCellRange(pMinZ, pMaxZ, cellSize);
      const probability = densityProbability(desc.density, cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const candKey = `${di}:${gx},${gz}`;
          const cached = flattenCandCache.get(candKey);
          if (cached !== undefined) {
            if (cached !== null) candidates.push(cached);
            continue;
          }
          if (flattenCandCache.size > 65536) dropOldestHalf(flattenCandCache);

          let cand: FlattenCandidate | null = null;
          const roll = rollDensityCell(desc.id, gx, gz, cellSize, probability, desc.clustering);
          if (roll) {
            const vd = computeVertexData(roll.x, roll.z); // RAW (computingFlatten guard)
            if (passesPlacementFilters(vd, desc)) {
              cand = { x: roll.x, z: roll.z, y: vd.height, biomeId: vd.biomeId, descIndex: di, gx, gz };
            }
          }
          flattenCandCache.set(candKey, cand);
          if (cand !== null) candidates.push(cand);
        }
      }
    }
  } finally {
    computingFlatten = false;
  }

  // Deterministic total order, then ITERATED LOCAL spacing (Matérn-II
  // rounds): within a round, a candidate is rejected when any earlier-ordered
  // POOL member sits within its own footprint — a purely local rule, so
  // every tile computes identical results (greedy against ACCEPTED points
  // was tried and REJECTED: acceptance chains propagate beyond any fixed
  // window and neighboring tiles disagreed). A single round saturates at
  // ~45% of greedy packing though — candidates blocked by other REJECTED
  // candidates stay empty — so rejected-but-viable candidates re-enter for
  // FLATTEN_SPACING_ROUNDS rounds against the actual winners, converging to
  // greedy-level density. Locality: round k decisions depend on ≤ k×footprint
  // neighborhoods, covered by the spacing window pad (ROUNDS × footprint).
  candidates.sort((a, b) => {
    const pa = descs[a.descIndex].priority;
    const pb = descs[b.descIndex].priority;
    if (pa !== pb) return pa - pb;
    if (a.descIndex !== b.descIndex) return a.descIndex - b.descIndex;
    if (a.gz !== b.gz) return a.gz - b.gz;
    return a.gx - b.gx;
  });
  const accepted: FlattenCandidate[] = [];
  let pool = candidates;
  for (let round = 0; round < FLATTEN_SPACING_ROUNDS && pool.length > 0; round++) {
    // Drop pool members blocked by prior rounds' winners — permanently out.
    if (round > 0) {
      pool = pool.filter((c) => {
        const fp = descs[c.descIndex].footprint;
        const fpSq = fp * fp;
        for (let i = 0; i < accepted.length; i++) {
          const dx = c.x - accepted[i].x;
          const dz = c.z - accepted[i].z;
          if (dx * dx + dz * dz < fpSq) return false;
        }
        return true;
      });
    }
    // Matérn II within the round's pool.
    const winners: FlattenCandidate[] = [];
    for (let ci = 0; ci < pool.length; ci++) {
      const c = pool[ci];
      const fp = descs[c.descIndex].footprint;
      const fpSq = fp * fp;
      let blocked = false;
      for (let j = 0; j < ci; j++) {
        const dx = c.x - pool[j].x;
        const dz = c.z - pool[j].z;
        if (dx * dx + dz * dz < fpSq) {
          blocked = true;
          break;
        }
      }
      if (!blocked) winners.push(c);
    }
    accepted.push(...winners);
    const winSet = new Set(winners);
    pool = pool.filter((c) => !winSet.has(c));
  }

  const points: FlattenPoint[] = [];
  for (const c of accepted) {
    if (c.x < minX || c.x >= maxX || c.z < minZ || c.z >= maxZ) continue; // tile ownership
    const desc = descs[c.descIndex];
    points.push({
      x: c.x,
      z: c.z,
      y: c.y,
      biomeId: c.biomeId,
      descId: desc.id,
      radius: desc.radius,
      skirt: desc.skirt,
    });
  }
  flattenTileCache.set(key, points);
  return points;
};

/** Flatten points with centers inside the bounds (spawn.worker sources
 *  flattenGround actors' spawn points from this). */
export function getFlattenPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): FlattenPoint[] {
  if (!cfg || !cfg.flattenDescriptors || cfg.flattenDescriptors.length === 0) return [];
  const out: FlattenPoint[] = [];
  const tx0 = Math.floor(minX / FLATTEN_TILE);
  const tx1 = Math.floor((maxX - 0.001) / FLATTEN_TILE);
  const tz0 = Math.floor(minZ / FLATTEN_TILE);
  const tz1 = Math.floor((maxZ - 0.001) / FLATTEN_TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      for (const p of flattenTilePoints(tx, tz)) {
        if (p.x >= minX && p.x < maxX && p.z >= minZ && p.z < maxZ) out.push(p);
      }
    }
  }
  return out;
}

/** Blend the height toward any overlapping pads (flat inside radius,
 *  smoothstep back to the raw terrain across the skirt). Influences apply in
 *  ASCENDING mask order so the dominant pad lands last: at dense packing a
 *  neighbor's skirt can reach into a pad's flat zone, and unordered
 *  application let it tilt the footing buildings stand on. */
// Parallel reused buffers, insertion-sorted on write (ascending mask, then y —
// almost always ≤3 entries). An object per influence per vertex was steady GC
// churn across every collider chunk build.
const flattenInfY: number[] = [];
const flattenInfMask: number[] = [];
const applyFlattenPads = (x: number, z: number, height: number): number => {
  let infCount = 0;
  const tx0 = Math.floor((x - flattenReach) / FLATTEN_TILE);
  const tx1 = Math.floor((x + flattenReach) / FLATTEN_TILE);
  const tz0 = Math.floor((z - flattenReach) / FLATTEN_TILE);
  const tz1 = Math.floor((z + flattenReach) / FLATTEN_TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      const points = flattenTilePoints(tx, tz);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const reach = p.radius + p.skirt;
        const dSq = dx * dx + dz * dz;
        if (dSq >= reach * reach) continue;
        const mask = 1 - smoothstep(p.radius, reach, Math.sqrt(dSq));
        // Insertion sort keeps (mask, y) ascending as we go
        let j = infCount++;
        while (
          j > 0 &&
          (flattenInfMask[j - 1] > mask || (flattenInfMask[j - 1] === mask && flattenInfY[j - 1] > p.y))
        ) {
          flattenInfMask[j] = flattenInfMask[j - 1];
          flattenInfY[j] = flattenInfY[j - 1];
          j--;
        }
        flattenInfMask[j] = mask;
        flattenInfY[j] = p.y;
      }
    }
  }
  for (let i = 0; i < infCount; i++) {
    height += (flattenInfY[i] - height) * flattenInfMask[i];
  }
  return height;
};

// ══════════════════════════════════════════════════════════════════════
// Main Pipeline
// ══════════════════════════════════════════════════════════════════════

let cfg: DomainConfig | null = null;

export function initCompute(config: DomainConfig): void {
  cfg = config;
  flattenTileCache.clear();
  flattenCandCache.clear();
  flattenReach = 0;
  flattenSpacingPad = 0;
  flattenBiomes = new Set<number>();
  for (const d of config.flattenDescriptors ?? []) {
    flattenReach = Math.max(flattenReach, d.radius + d.skirt);
    // Round-k spacing decisions depend on ≤ k×footprint neighborhoods.
    flattenSpacingPad = Math.max(flattenSpacingPad, d.footprint * FLATTEN_SPACING_ROUNDS);
    if (d.biomeIds && d.biomeIds.length > 0) {
      for (const b of d.biomeIds) flattenBiomes.add(b);
    } else {
      flattenBiomes = null; // an unrestricted descriptor — pads possible anywhere
    }
    if (flattenBiomes === null) break;
  }
}

const regionGridFn = (point: Vec2, regions: SerializedRegion[]) => {
  const uuid = seedRand(`${point.x},${point.y}`);
  return regions[Math.floor(uuid * regions.length)];
};

const biomeGridFn = (point: Vec2, rGrid: VGrid[]) => {
  const nearest = getNearestEntry(point, rGrid);
  const region: SerializedRegion = nearest.element;
  const uuid = seedRand(`${point.x},${point.y}`);
  return region.biomes[Math.floor(uuid * region.biomes.length)];
};

/** Region + biome voronoi context at a (road-noise-warped) vertex — shared by
 *  computeVertexData and the road-marker enumeration. */
const getBiomeContext = (currentVertex: Vec2) => {
  const regionGrid = getVoronoiGrid(
    `${cfg!.seed} - regionGrid`,
    currentVertex,
    cfg!.regions,
    cfg!.regionGridSize,
    regionGridFn
  );
  const biomeGrid = getVoronoiGrid(
    `${cfg!.seed} - grid`,
    currentVertex,
    regionGrid,
    cfg!.gridSize,
    biomeGridFn
  );
  const biome: SerializedBiome = getNearestEntry(currentVertex, biomeGrid).element;
  const { biomeWalls, riverWalls } = getWalls(
    cfg!.seed,
    currentVertex,
    biomeGrid,
    regionGrid,
    cfg!.gridSize
  );
  return { biome, biomeWalls, riverWalls };
};

export function computeVertexData(x: number, z: number): VertexResult {
  if (!cfg) throw new Error("vertexCompute not initialized");

  // Step 1: Road noise offset
  const cvx = x + terrainNoise(cfg.roadNoiseParams, z, 0);
  const cvz = z + terrainNoise(cfg.roadNoiseParams, x, 0);
  const currentVertex: Vec2 = { x: cvx, y: cvz };

  // Step 2: Voronoi — region grid, biome grid, walls
  const { biome, biomeWalls, riverWalls } = getBiomeContext(currentVertex);
  const distanceToBiomeBoundary = distanceToWall(cvx, cvz, biomeWalls);
  const biomeWallAlong = lastWallAlong; // capture before the river call overwrites
  const distanceToRiver = distanceToWall(cvx, cvz, riverWalls);

  // Step 3: Blend
  const blendWidth = biome.blendWidth || cfg.defaultBlendWidth;
  const blend =
    Math.min(blendWidth, Math.max(distanceToBiomeBoundary - cfg.boundaryWidth, 0)) / blendWidth;

  // Step 4: Biome height (baseHeight computed once — the city branch levels
  // its blocks against it, and step 5 adds it to every biome)
  const baseHeight = terrainNoise(cfg.baseNoiseParams, x, z);
  let biomeHeight = 0;
  let distanceToRoadCenter = distanceToBiomeBoundary;
  let distanceToFreewayCenter = 99999;
  let freewayAlong = 0;

  if (distanceToRiver > cfg.riverWidth) {
    const riverFade = Math.min(1.0, (distanceToRiver - cfg.riverWidth) / cfg.riverWidth);
    const biomeId = biome.id;
    const noiseConfig = cfg.biomeNoiseConfigs[biomeId];

    if (noiseConfig) {
      // Noise-based biome
      let h = terrainNoise(noiseConfig.params, x, z);
      if (noiseConfig.absNeg) h = Math.abs(h) * -1;
      if (noiseConfig.scale !== undefined) h *= noiseConfig.scale;
      if (noiseConfig.offset !== undefined) h += noiseConfig.offset;
      biomeHeight = h * blend * riverFade;
    } else if (cfg.cityConfig && biomeId === CITY_BIOME_ID) {
      // City biome — internal road distance + per-block plateau elevation
      const city = getCityTerrain(x, z, cfg.cityConfig, biomeWalls, distanceToBiomeBoundary, biomeWallAlong);
      distanceToRoadCenter = Math.min(city.dist, distanceToRiver);
      distanceToFreewayCenter = city.paintDist;
      freewayAlong = city.paintAlong;
      // The city RIDES the regional base noise: cities sit at varied
      // elevations following the region, with plateaus/roads/curbs as
      // RELATIVE offsets on top (base added in step 5). Flat building
      // footing comes from the flatten-ground PADS applied below — NOT from
      // cancelling the base (every city at ~height 0 — rejected) or leveling
      // whole blocks (city-only mechanism — rejected in favor of pads that
      // work in every biome).
      biomeHeight = city.elevation * blend * riverFade;
    }
  }

  // Step 5: Base noise
  let height = biomeHeight + baseHeight;

  // Step 6: flatten-ground pads (skipped while evaluating pad candidates —
  // their filters and pad heights are defined against the RAW terrain — and
  // skipped entirely in biomes no flatten descriptor targets, so pad tiles
  // are only ever computed where pads can exist)
  if (
    !computingFlatten &&
    cfg.flattenDescriptors &&
    cfg.flattenDescriptors.length > 0 &&
    (flattenBiomes === null || flattenBiomes.has(biome.id))
  ) {
    height = applyFlattenPads(x, z, height);
  }

  return {
    height,
    biomeId: biome.id,
    blend,
    distanceToBiomeBoundaryCenter: distanceToBiomeBoundary,
    distanceToRiverCenter: distanceToRiver,
    distanceToRoadCenter,
    distanceToFreewayCenter,
    freewayAlong,
  };
}

// ══════════════════════════════════════════════════════════════════════
// City feature enumeration helpers (shared by the road-marker /
// traffic-light / freeway-side enumerations)
// ══════════════════════════════════════════════════════════════════════

/** District-local cell lookup with the local biome walls (rim detection),
 *  mirroring computeVertexData's road-noise warp for the context. */
const cityCellAtLocal = (ix: number, iy: number, d: CityDistrict): CityCell => {
  // Cache-first: getCityCell only needs the walls/noise context on a genuine
  // miss, but building that context costs 2 road-noise FBMs + the voronoi
  // lookup — paying it on every call made cache HITS the dominant cost of
  // the dressing enumerations (markers probe this 3× per candidate).
  const city = cfg!.cityConfig;
  const store = cityCellCaches[city.seed];
  const cached = store && cityCellLookup(store, d.key, ix, iy);
  if (cached) return cached;

  const gs = city.gridSize;
  const w = cityLocalToWorld((ix + 0.5) * gs, (iy + 0.5) * gs, d);
  const warped: Vec2 = {
    x: w.x + terrainNoise(cfg!.roadNoiseParams, w.y, 0),
    y: w.y + terrainNoise(cfg!.roadNoiseParams, w.x, 0),
  };
  return getCityCell(ix, iy, getBiomeContext(warped).biomeWalls, d);
};

/** Local AABB of the chunk∩district overlap (rotate the overlap's corners
 *  into the district frame). District extent padded by the boundary wiggle
 *  amplitude. Null when chunk and district don't overlap. */
const cityChunkLocalAABB = (
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
    const dz = czw - d.py;
    const lcx = d.px + dx * d.cos + dz * d.sin;
    const lcz = d.py - dx * d.sin + dz * d.cos;
    if (lcx < lminX) lminX = lcx;
    if (lcx > lmaxX) lmaxX = lcx;
    if (lcz < lminZ) lminZ = lcz;
    if (lcz > lmaxZ) lmaxZ = lcz;
  }
  return { lminX, lmaxX, lminZ, lmaxZ };
};

// ══════════════════════════════════════════════════════════════════════
// Road markers (raised pavement markers along road centerlines)
// ══════════════════════════════════════════════════════════════════════

export interface RoadMarkerPoint {
  x: number;
  y: number; // terrain height at the marker (curb dip included)
  z: number;
  dirX: number; // unit direction of the road at this marker
  dirZ: number;
}

/**
 * Enumerates raised-pavement-marker positions along road CENTERLINES inside
 * the given world-space bounds: per-district street boundaries, triangle
 * diagonals and roundabout rings (computed in each district's rotated local
 * frame, then rotated out), plus the world-aligned arterial boundary roads.
 * Ownership by world position (deterministic positions per district / global
 * lattices for arterials) guarantees calls over non-overlapping chunks never
 * emit duplicates.
 *
 * Runs anywhere initCompute has run (uses the same caches as
 * computeVertexData) — the RoadMarkers component calls it on the main thread.
 */
export function getCityRoadMarkers(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): RoadMarkerPoint[] {
  if (!cfg || !cfg.cityConfig) return [];
  const city = cfg.cityConfig;
  const gs = city.gridSize;
  const out: RoadMarkerPoint[] = [];

  const tryEmit = (mx: number, mz: number, dirX: number, dirZ: number) => {
    const vd = computeVertexData(mx, mz);
    if (vd.biomeId !== CITY_BIOME_ID) return; // city biome only
    if (vd.distanceToRiverCenter < 45) return;
    if (vd.distanceToRoadCenter > 2) return; // melted/chamfered zones drop out
    // Street/arterial markers exist only strictly INSIDE the belt freeway
    // ring (centerline at boundaryWidth + freewayWidth): one-sided check so
    // it skips the belt corridor AND everything beyond it. (An abs-window
    // corridor check was used before and LEAKED — the strip between the
    // belt's outer edge and the biome boundary sits outside the window, and
    // rim ring-road cell boundaries emitted markers past the city edge.)
    if (
      vd.distanceToBiomeBoundaryCenter <
      cfg!.boundaryWidth + city.freewayWidth * 2 + 5
    )
      return;
    out.push({ x: mx, y: vd.height, z: mz, dirX, dirZ });
  };

  // ── District-local street / feature markers ──
  // For each district overlapping the bounds, run the cell enumeration in the
  // district's LOCAL frame and rotate results out. Every marker is owned by
  // the chunk containing its WORLD position (positions are deterministic per
  // district, so chunked calls never duplicate), clipped to the district
  // (by the wiggly assignment), and stopped short of arterials. Index ranges
  // padded ±1 for the boundary wiggle.
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const rows0 = findCityRow(minZ, midX) - 1;
  const rows1 = findCityRow(maxZ - 0.001, midX) + 1;
  for (let r = rows0; r <= rows1; r++) {
    const m0 = findCitySeg(r, minX, midZ) - 1;
    const m1 = findCitySeg(r, maxX - 0.001, midZ) + 1;
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);

      // Cell lookup with the local biome walls (rim detection), mirroring
      // computeVertexData's road-noise warp for the context.
      const cellAt = (ix: number, iy: number): CityCell => cityCellAtLocal(ix, iy, d);

      const emitLocal = (lmx: number, lmz: number, ldx: number, ldz: number) => {
        const p = cityLocalToWorld(lmx, lmz, d);
        if (p.x < minX || p.x >= maxX || p.y < minZ || p.y >= maxZ) return; // chunk ownership
        if (getCityDistrict(p.x, p.y).key !== d.key) return; // district clip (wiggly edges)
        if (cityArterialDist(p.x, p.y, d) < city.freewayWidth + 5) return; // stop at arterials
        tryEmit(p.x, p.y, ldx * d.cos - ldz * d.sin, ldx * d.sin + ldz * d.cos);
      };

      // Local marker on a boundary sits exactly on a cell edge — test the
      // cell and its west/south neighbors for a roundabout ring.
      const insideRoundabout = (lmx: number, lmz: number): boolean => {
        const cx = Math.floor(lmx / gs);
        const cz = Math.floor(lmz / gs);
        for (const [ix, iy] of [
          [cx, cz],
          [cx - 1, cz],
          [cx, cz - 1],
        ]) {
          if (cellAt(ix, iy).shape !== CITY_SHAPE_CIRCLE) continue;
          const sx = Math.floor(ix / 2);
          const sy = Math.floor(iy / 2);
          const rr = Math.hypot(lmx - (2 * sx + 1) * gs, lmz - (2 * sy + 1) * gs);
          if (rr < gs * CITY_RING_RADIUS_FRAC + city.roadWidth + 4) return true;
        }
        return false;
      };

      const aabb = cityChunkLocalAABB(d, minX, minZ, maxX, maxZ);
      if (!aabb) continue;
      const { lminX, lmaxX, lminZ, lmaxZ } = aabb;

      const inset = city.roadWidth + 4; // keep markers out of grid intersections
      const ix0 = Math.floor(lminX / gs) - 1;
      const ix1 = Math.floor(lmaxX / gs) + 1;
      const iy0 = Math.floor(lminZ / gs) - 1;
      const iy1 = Math.floor(lmaxZ / gs) + 1;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const cell = cellAt(ix, iy);
          const curL = cell.label;

          // East boundary: x = (ix+1)·gs, z ∈ [iy·gs, (iy+1)·gs]
          if (cellAt(ix + 1, iy).label !== curL) {
            const bx = (ix + 1) * gs;
            for (let z = iy * gs + inset; z <= (iy + 1) * gs - inset; z += streetSpacing) {
              if (insideRoundabout(bx, z)) continue;
              emitLocal(bx, z, 0, 1);
            }
          }

          // North boundary: z = (iy+1)·gs, x ∈ [ix·gs, (ix+1)·gs]
          if (cellAt(ix, iy + 1).label !== curL) {
            const bz = (iy + 1) * gs;
            for (let x = ix * gs + inset; x <= (ix + 1) * gs - inset; x += streetSpacing) {
              if (insideRoundabout(x, bz)) continue;
              emitLocal(x, bz, 1, 0);
            }
          }

          if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
            // 2×2 flatiron — emitted from the super-cell's anchor cell only;
            // per-marker ownership dedupes across chunks.
            const sx = Math.floor(ix / 2);
            const sy = Math.floor(iy / 2);
            if (ix !== 2 * sx || iy !== 2 * sy) continue;
            const side = 2 * gs;
            const diagLen = side * Math.SQRT2;
            const dirX = Math.SQRT1_2;
            const dirZ = cell.shape === CITY_SHAPE_TRI_NE ? Math.SQRT1_2 : -Math.SQRT1_2;
            const startX = 2 * sx * gs;
            const startZ = cell.shape === CITY_SHAPE_TRI_NE ? 2 * sy * gs : 2 * sy * gs + side;
            const diagInset = inset * Math.SQRT1_2 + city.roadWidth;
            for (let t = diagInset; t <= diagLen - diagInset; t += streetSpacing) {
              emitLocal(startX + dirX * t, startZ + dirZ * t, dirX, dirZ);
            }
          } else if (cell.shape === CITY_SHAPE_CIRCLE) {
            // 2×2 roundabout — emitted from the anchor cell only; markers
            // ring the island tangentially.
            const sx = Math.floor(ix / 2);
            const sy = Math.floor(iy / 2);
            if (ix !== 2 * sx || iy !== 2 * sy) continue;
            const scx = (2 * sx + 1) * gs;
            const scz = (2 * sy + 1) * gs;
            const ringR = gs * CITY_RING_RADIUS_FRAC;
            const count = Math.max(8, Math.round((2 * Math.PI * ringR) / streetSpacing));
            for (let i = 0; i < count; i++) {
              const a = (i / count) * 2 * Math.PI;
              emitLocal(scx + Math.cos(a) * ringR, scz + Math.sin(a) * ringR, -Math.sin(a), Math.cos(a));
            }
          }
        }
      }
    }
  }

  // ── Arterial centerlines (wiggly district boundary roads) ──
  // Markers sit on GLOBAL parameter lattices, so chunked calls stay
  // duplicate-free; positions follow the wiggle curve and are oriented along
  // its tangent. Junctions with crossing arterials are skipped.
  const pitch = cityDistrictPitch();
  const fwClear = city.freewayWidth + 6;

  // Horizontal row-boundary curves (full-width; between rows k−1 and k)
  for (let k = Math.floor(minZ / pitch) - 1; k <= Math.floor(maxZ / pitch) + 2; k++) {
    const bzBase = cityRowBoundary(k);
    if (bzBase < minZ - CITY_WIGGLE_AMP || bzBase >= maxZ + CITY_WIGGLE_AMP) continue;
    for (let j = Math.ceil(minX / freewaySpacing); j * freewaySpacing < maxX; j++) {
      const mx = j * freewaySpacing;
      const mz = cityRowEdgeZ(k, mx);
      if (mz < minZ || mz >= maxZ) continue; // ownership by actual (wiggled) position
      // skip T-junctions with the vertical boundaries of both adjacent rows
      let nearVertical = false;
      for (const rr of [k - 1, k]) {
        const mm = findCitySeg(rr, mx, mz);
        if (
          Math.abs(mx - citySegEdgeX(rr, mm, mz)) < fwClear ||
          Math.abs(mx - citySegEdgeX(rr, mm + 1, mz)) < fwClear
        ) {
          nearVertical = true;
          break;
        }
      }
      if (nearVertical) continue;
      const slope = cityWiggleSlope(`r${k}`, mx);
      const norm = Math.hypot(1, slope);
      tryEmit(mx, mz, 1 / norm, slope / norm);
    }
  }

  // Vertical segment-boundary curves (within each row)
  for (let r = rows0; r <= rows1; r++) {
    const m0 = findCitySeg(r, minX, midZ) - 1;
    const m1 = findCitySeg(r, maxX - 0.001, midZ) + 1;
    for (let m = m0; m <= m1 + 1; m++) {
      const bxBase = citySegBoundary(r, m);
      if (bxBase < minX - CITY_WIGGLE_AMP || bxBase >= maxX + CITY_WIGGLE_AMP) continue;
      for (let j = Math.ceil(minZ / freewaySpacing); j * freewaySpacing < maxZ; j++) {
        const mz = j * freewaySpacing;
        const mx = citySegEdgeX(r, m, mz);
        if (mx < minX || mx >= maxX) continue; // ownership by actual (wiggled) position
        // clamp to this row's (wiggled) span and skip row-boundary junctions
        const rz0 = cityRowEdgeZ(r, mx);
        const rz1 = cityRowEdgeZ(r + 1, mx);
        if (mz - rz0 < fwClear || rz1 - mz < fwClear) continue;
        const slope = cityWiggleSlope(`s${r}:${m}`, mz);
        const norm = Math.hypot(1, slope);
        tryEmit(mx, mz, slope / norm, 1 / norm);
      }
    }
  }

  // ── Belt freeway median markers (the ring around the city rim) ──
  // The belt centerline is the offset curve (boundaryWidth + freewayWidth)
  // inside the biome boundary. Enumerate by stepping along the biome WALL
  // segments (warped space), offsetting perpendicular to BOTH sides, and
  // inverting the road-noise warp back to real space; the off-city candidate
  // and any drift die in the validity filters. Positions are deterministic
  // per wall, so chunk-bounds ownership stays duplicate-free.
  const beltR = cfg.boundaryWidth + city.freewayWidth;
  const wcx = (minX + maxX) / 2;
  const wcz = (minZ + maxZ) / 2;
  const beltWalls = getBiomeContext({
    x: wcx + terrainNoise(cfg.roadNoiseParams, wcz, 0),
    y: wcz + terrainNoise(cfg.roadNoiseParams, wcx, 0),
  }).biomeWalls;
  for (const wall of beltWalls) {
    // getWalls emits each voronoi wall twice (once per Delaunay halfedge,
    // endpoints swapped) — keep the canonical orientation only.
    if (wall.ex < wall.sx || (wall.ex === wall.sx && wall.ey < wall.sy)) continue;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ey - wall.sy;
    const wlen = Math.hypot(wdx, wdz);
    if (wlen < freewaySpacing) continue;
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    for (let t = freewaySpacing / 2; t < wlen; t += freewaySpacing) {
      for (const side of [1, -1]) {
        // Warped-space point on the belt centerline
        const twx = wall.sx + ux * t - uz * beltR * side;
        const twz = wall.sy + uz * t + ux * beltR * side;
        // Invert the road-noise warp (fixed point; the warp is smooth and
        // large-scale, so a few iterations land within the sanity filters)
        let mx = twx;
        let mz = twz;
        for (let it = 0; it < 3; it++) {
          mx = twx - terrainNoise(cfg.roadNoiseParams, mz, 0);
          mz = twz - terrainNoise(cfg.roadNoiseParams, mx, 0);
        }
        if (mx < minX || mx >= maxX || mz < minZ || mz >= maxZ) continue; // chunk ownership
        const vd = computeVertexData(mx, mz);
        if (vd.biomeId !== CITY_BIOME_ID) continue; // kills the outward-side candidate
        if (Math.abs(vd.distanceToBiomeBoundaryCenter - beltR) > 2.5) continue;
        if (vd.distanceToRoadCenter > 2) continue;
        if (vd.distanceToRiverCenter < 45) continue;
        // yield to arterial junctions like all markers do
        if (cityArterialDist(mx, mz, getCityDistrict(mx, mz)) < city.freewayWidth + 6) continue;
        out.push({ x: mx, y: vd.height, z: mz, dirX: ux, dirZ: uz });
      }
    }
  }

  return out;
}

// ══════════════════════════════════════════════════════════════════════
// City voronoi sites (one per city-biome cell — used by CityLights)
// ══════════════════════════════════════════════════════════════════════

export interface CitySitePoint {
  key: string; // biome-grid cell key — stable identity across queries
  x: number;
  y: number; // terrain height at the site
  z: number;
}

/**
 * The voronoi SITE point (jittered seed point) of every biome-grid cell
 * inside the bounds that rolled the CITY biome — i.e. one point per city.
 * Rolls the exact same seeds as the biome grid (getVoronoiGrid + biomeGridFn),
 * so the result matches the pipeline's assignment without touching its caches'
 * semantics. Sites live in road-noise-warped space (where the biome voronoi is
 * evaluated), so each is warp-inverted back to real world coordinates — the
 * returned point is where the cell's visual voronoi center actually sits.
 */
export function getCityVoronoiSites(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): CitySitePoint[] {
  if (!cfg) throw new Error("vertexCompute not initialized");
  const gs = cfg.gridSize;
  const seed = `${cfg.seed} - grid`;
  const out: CitySitePoint[] = [];
  // Pad one cell ring: the road-noise warp shifts world↔warped by less than a
  // cell, so sites belonging just outside the bounds can land inside them.
  const ix0 = Math.floor(minX / gs) - 1;
  const ix1 = Math.floor(maxX / gs) + 1;
  const iy0 = Math.floor(minZ / gs) - 1;
  const iy1 = Math.floor(maxZ / gs) + 1;

  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const px = seedRand(`${seed} - ${ix}X${iy}`);
      const py = seedRand(`${seed} - ${ix}Y${iy}`);
      const site: Vec2 = { x: (ix + px) * gs, y: (iy + py) * gs };
      // Same biome roll the grid makes for this cell: nearest region point →
      // seeded pick among that region's biomes.
      const regionGrid = getVoronoiGrid(
        `${cfg.seed} - regionGrid`,
        site,
        cfg.regions,
        cfg.regionGridSize,
        regionGridFn
      );
      const biome: SerializedBiome = biomeGridFn(site, regionGrid);
      if (biome.id !== 1) continue;
      // Invert the road-noise warp (fixed point — same as the belt markers)
      let wx = site.x;
      let wz = site.y;
      for (let it = 0; it < 3; it++) {
        wx = site.x - terrainNoise(cfg.roadNoiseParams, wz, 0);
        wz = site.y - terrainNoise(cfg.roadNoiseParams, wx, 0);
      }
      // RAW height: the site feeds a beacon floating heightOffset above the
      // ground — flatten-pad deltas are irrelevant, and the padded path
      // would compute pad tiles for every site.
      out.push({ key: `${ix},${iy}`, x: wx, y: computeVertexDataRaw(wx, wz).height, z: wz });
    }
  }

  return out;
}

// ══════════════════════════════════════════════════════════════════════
// Traffic lights (signalized street intersections)
// ══════════════════════════════════════════════════════════════════════

export interface CityTrafficLightPoint {
  x: number;
  y: number; // terrain height at the pole base (sidewalk corner)
  z: number;
  dirX: number; // unit direction the signal head faces (toward the intersection)
  dirZ: number;
  phase: number; // seeded [0,1) — desynchronizes the per-light signal cycles
}

/**
 * Pole positions for traffic lights at SOME street intersections (seeded
 * per-intersection roll against `chance`). An intersection is a district-grid
 * corner where at least 3 road arms meet (labels differ across ≥3 of the 4
 * edges radiating from the corner). Each selected intersection gets a pole on
 * every block corner that survives validation: the pole is pushed diagonally
 * outward from the corner until it lands in the sidewalk band of the road
 * field (the corner chamfer means the diagonal offset varies), facing back
 * toward the intersection center.
 *
 * Ownership is by the CORNER's world position (a single deterministic point),
 * so calls over non-overlapping chunks never emit duplicate poles even when
 * an intersection's poles straddle a chunk border.
 */
export function getCityTrafficLightPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chance: number
): CityTrafficLightPoint[] {
  if (!cfg || !cfg.cityConfig) return [];
  const city = cfg.cityConfig;
  const gs = city.gridSize;
  const beltR = cfg.boundaryWidth + city.freewayWidth;
  const out: CityTrafficLightPoint[] = [];

  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const rows0 = findCityRow(minZ, midX) - 1;
  const rows1 = findCityRow(maxZ - 0.001, midX) + 1;
  for (let r = rows0; r <= rows1; r++) {
    const m0 = findCitySeg(r, minX, midZ) - 1;
    const m1 = findCitySeg(r, maxX - 0.001, midZ) + 1;
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);
      const aabb = cityChunkLocalAABB(d, minX, minZ, maxX, maxZ);
      if (!aabb) continue;

      const ix0 = Math.floor(aabb.lminX / gs) - 1;
      const ix1 = Math.floor(aabb.lmaxX / gs) + 2;
      const iy0 = Math.floor(aabb.lminZ / gs) - 1;
      const iy1 = Math.floor(aabb.lmaxZ / gs) + 2;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          // Corner at local (ix·gs, iy·gs); the four cells around it.
          const A = cityCellAtLocal(ix - 1, iy - 1, d);
          const B = cityCellAtLocal(ix, iy - 1, d);
          const C = cityCellAtLocal(ix - 1, iy, d);
          const D = cityCellAtLocal(ix, iy, d);
          // Rim cells (whole cell = ring road) and roundabout territory
          // (curved ring roads, radiating tees) never get signals.
          if (A.label < 0 || B.label < 0 || C.label < 0 || D.label < 0) continue;
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
          if (seedRand(`${city.seed}-tl-${d.key}|${ix},${iy}`) >= chance) continue;

          const pc = cityLocalToWorld(ix * gs, iy * gs, d);
          // Ownership by the corner's world position — one deterministic
          // point decides which chunk emits the whole intersection.
          if (pc.x < minX || pc.x >= maxX || pc.y < minZ || pc.y >= maxZ) continue;
          if (getCityDistrict(pc.x, pc.y).key !== d.key) continue; // wiggly district clip
          // Intersections near arterials lose their corners to the wide
          // chamfer — skip them entirely.
          if (cityArterialDist(pc.x, pc.y, d) < city.freewayWidth + 16) continue;

          const lx = ix * gs;
          const lz = iy * gs;
          for (const [sx, sz] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]) {
            // March diagonally out from the corner until the road field says
            // sidewalk (the chamfer cuts corners at varying depths).
            for (let off = 16; off <= 26; off += 2) {
              const p = cityLocalToWorld(
                lx + sx * off * Math.SQRT1_2,
                lz + sz * off * Math.SQRT1_2,
                d
              );
              const vd = computeVertexData(p.x, p.y);
              if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < 45) break;
              // One-sided like the road markers: only strictly inside the belt
              // ring (skips the corridor AND the strip beyond it).
              if (vd.distanceToBiomeBoundaryCenter < beltR + city.freewayWidth + 5)
                break;
              if (vd.distanceToRoadCenter < 8.4) continue; // still on road/curb
              if (vd.distanceToRoadCenter > 11.6) break; // past the sidewalk — no footing
              // Face back toward the intersection center (local diagonal,
              // rotated into the world frame).
              const fx = -sx * Math.SQRT1_2;
              const fz = -sz * Math.SQRT1_2;
              out.push({
                x: p.x,
                y: vd.height,
                z: p.y,
                dirX: fx * d.cos - fz * d.sin,
                dirZ: fx * d.sin + fz * d.cos,
                phase: seedRand(`${city.seed}-tlph-${d.key}|${ix},${iy}|${sx},${sz}`),
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

// ══════════════════════════════════════════════════════════════════════
// Freeway-side features (power lines / barriers along arterials + belt)
// ══════════════════════════════════════════════════════════════════════

export interface CityFreewaySidePoint {
  x: number;
  y: number; // terrain height at the point
  z: number;
  dirX: number; // unit tangent along the freeway
  dirZ: number;
  side: number; // +1 / −1: which side of the centerline (belt: +1 = city side)
  next?: { x: number; y: number; z: number }; // next point along the run (wire spans)
}

/**
 * Points offset `lateral` real units to BOTH sides of every freeway
 * centerline — the wiggly arterial district boundaries and the belt ring —
 * spaced `spacing` apart along the run, with the freeway tangent direction.
 * Candidates within `junctionClear` of a crossing freeway feature are
 * skipped (runs end cleanly before interchanges), and candidates whose road
 * field says they'd sit on road surface (street tees, merge chamfers) drop
 * out, leaving natural gaps at street mouths.
 *
 * Positions sit on global parameter lattices (arterials) / deterministic
 * per-wall steps (belt), so chunked calls never emit duplicates. With
 * `withNext`, each point carries the position of the NEXT valid point along
 * its run (the same point the neighboring lattice step would emit) so a
 * caller can hang wires across chunk borders without coordination.
 *
 * NOTE: belt candidates come from the wall set visible from the QUERY CENTER
 * (same caveat as the belt median markers) — call with a consistent chunk
 * size for stable belt coverage; ownership keeps disjoint queries
 * duplicate-free regardless.
 */
export function getCityFreewaySidePoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  spacing: number,
  lateral: number,
  junctionClear: number,
  withNext: boolean
): CityFreewaySidePoint[] {
  if (!cfg || !cfg.cityConfig) return [];
  const city = cfg.cityConfig;
  const fwScale = city.roadWidth / city.freewayWidth;
  const beltR = cfg.boundaryWidth + city.freewayWidth;
  const minField = lateral * fwScale - 1.5; // reject points melted into road
  const out: CityFreewaySidePoint[] = [];

  type Candidate = { x: number; y: number; z: number; dirX: number; dirZ: number } | null;

  // Ownership filter, applied BEFORE any expensive validation: candidates a
  // chunk doesn't own must cost only the position arithmetic (the belt scan
  // especially visits every nearby wall for EVERY city chunk — validating
  // out-of-bounds candidates there made chunk builds an order of magnitude
  // slower than the road markers). Next-link lookups (`owned = false`) skip
  // it: a successor usually lives in the neighboring chunk.
  const owns = (px: number, pz: number): boolean =>
    px >= minX && px < maxX && pz >= minZ && pz < maxZ;

  const validate = (px: number, pz: number, ux: number, uz: number): Candidate => {
    const vd = computeVertexData(px, pz);
    if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < 45) return null;
    // Stay clear of the belt corridor (arterials empty into it).
    if (Math.abs(vd.distanceToBiomeBoundaryCenter - beltR) < city.freewayWidth + junctionClear)
      return null;
    if (vd.distanceToRoadCenter < minField) return null;
    return { x: px, y: vd.height, z: pz, dirX: ux, dirZ: uz };
  };

  // ── Arterial rows (horizontal boundary curves) ──
  const evalRow = (k: number, j: number, side: number, owned: boolean): Candidate => {
    const mx = j * spacing;
    const mz = cityRowEdgeZ(k, mx);
    const slope = cityWiggleSlope(`r${k}`, mx);
    const norm = Math.hypot(1, slope);
    const ux = 1 / norm;
    const uz = slope / norm;
    // Left normal of the tangent, flipped by side.
    const px = mx - uz * lateral * side;
    const pz = mz + ux * lateral * side;
    if (owned && !owns(px, pz)) return null;
    // Skip T-junctions with the vertical boundaries of both adjacent rows.
    for (const rr of [k - 1, k]) {
      const mm = findCitySeg(rr, mx, mz);
      if (
        Math.abs(mx - citySegEdgeX(rr, mm, mz)) < junctionClear ||
        Math.abs(mx - citySegEdgeX(rr, mm + 1, mz)) < junctionClear
      )
        return null;
    }
    return validate(px, pz, ux, uz);
  };

  const pitch = cityDistrictPitch();
  const pad = CITY_WIGGLE_AMP + lateral + spacing;
  for (let k = Math.floor(minZ / pitch) - 1; k <= Math.floor(maxZ / pitch) + 2; k++) {
    const bzBase = cityRowBoundary(k);
    if (bzBase < minZ - pad || bzBase >= maxZ + pad) continue;
    // Lattice scan padded by `lateral`: the side offset shifts a point up to
    // lateral·slope ALONG the row, so a point owned by these bounds can hang
    // off a lattice step outside them (ownership dedupes the overlap).
    for (let j = Math.ceil((minX - lateral) / spacing); j * spacing < maxX + lateral; j++) {
      for (const side of [1, -1]) {
        const p = evalRow(k, j, side, true);
        if (!p) continue;
        const point: CityFreewaySidePoint = { ...p, side };
        if (withNext) {
          const n = evalRow(k, j + 1, side, false);
          if (n) point.next = { x: n.x, y: n.y, z: n.z };
        }
        out.push(point);
      }
    }
  }

  // ── Arterial segments (vertical boundary curves, within each row) ──
  const evalSeg = (r: number, m: number, j: number, side: number, owned: boolean): Candidate => {
    const mz = j * spacing;
    const mx = citySegEdgeX(r, m, mz);
    const slope = cityWiggleSlope(`s${r}:${m}`, mz);
    const norm = Math.hypot(1, slope);
    const ux = slope / norm;
    const uz = 1 / norm;
    const px = mx - uz * lateral * side;
    const pz = mz + ux * lateral * side;
    if (owned && !owns(px, pz)) return null;
    // Clamp to this row's (wiggled) span, clear of the row-boundary junctions.
    const rz0 = cityRowEdgeZ(r, mx);
    const rz1 = cityRowEdgeZ(r + 1, mx);
    if (mz - rz0 < junctionClear || rz1 - mz < junctionClear) return null;
    return validate(px, pz, ux, uz);
  };

  const midXf = (minX + maxX) / 2;
  const midZf = (minZ + maxZ) / 2;
  const frows0 = findCityRow(minZ, midXf) - 1;
  const frows1 = findCityRow(maxZ - 0.001, midXf) + 1;
  for (let r = frows0; r <= frows1; r++) {
    const m0 = findCitySeg(r, minX, midZf) - 1;
    const m1 = findCitySeg(r, maxX - 0.001, midZf) + 1;
    for (let m = m0; m <= m1 + 1; m++) {
      const bxBase = citySegBoundary(r, m);
      if (bxBase < minX - pad || bxBase >= maxX + pad) continue;
      // Same `lateral` scan pad as the row lattice above.
      for (let j = Math.ceil((minZ - lateral) / spacing); j * spacing < maxZ + lateral; j++) {
        for (const side of [1, -1]) {
          const p = evalSeg(r, m, j, side, true);
          if (!p) continue;
          const point: CityFreewaySidePoint = { ...p, side };
          if (withNext) {
            const n = evalSeg(r, m, j + 1, side, false);
            if (n) point.next = { x: n.x, y: n.y, z: n.z };
          }
          out.push(point);
        }
      }
    }
  }

  // ── Belt freeway (the ring around the city rim) ──
  // Same wall-stepping + warp-inversion approach as the belt median markers:
  // offset each candidate beltR ± lateral from the biome wall in warped
  // space, invert the road-noise warp, and let the validity filters kill the
  // off-city candidates. side +1 = the city side of the belt.
  const wcx = (minX + maxX) / 2;
  const wcz = (minZ + maxZ) / 2;
  const beltWalls = getBiomeContext({
    x: wcx + terrainNoise(cfg.roadNoiseParams, wcz, 0),
    y: wcz + terrainNoise(cfg.roadNoiseParams, wcx, 0),
  }).biomeWalls;
  const evalBelt = (wall: Wall, t: number, s: number, side: number, owned: boolean): Candidate => {
    if (t <= 0 || t >= Math.hypot(wall.ex - wall.sx, wall.ey - wall.sy)) return null;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ey - wall.sy;
    const wlen = Math.hypot(wdx, wdz);
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    const o = beltR + side * lateral;
    const twx = wall.sx + ux * t - uz * o * s;
    const twz = wall.sy + uz * t + ux * o * s;
    let mx = twx;
    let mz = twz;
    for (let it = 0; it < 3; it++) {
      mx = twx - terrainNoise(cfg!.roadNoiseParams, mz, 0);
      mz = twz - terrainNoise(cfg!.roadNoiseParams, mx, 0);
    }
    if (owned && !owns(mx, mz)) return null;
    const vd = computeVertexData(mx, mz);
    if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < 45) return null;
    if (Math.abs(vd.distanceToBiomeBoundaryCenter - o) > 2.5) return null; // drift / wrong side
    if (vd.distanceToRoadCenter < minField) return null;
    // Yield to the arterials teeing into the belt.
    if (cityArterialDist(mx, mz, getCityDistrict(mx, mz)) < city.freewayWidth + junctionClear)
      return null;
    return { x: mx, y: vd.height, z: mz, dirX: ux, dirZ: uz };
  };
  for (const wall of beltWalls) {
    // getWalls emits each wall twice endpoint-swapped — canonical orientation only.
    if (wall.ex < wall.sx || (wall.ex === wall.sx && wall.ey < wall.sy)) continue;
    const wlen = Math.hypot(wall.ex - wall.sx, wall.ey - wall.sy);
    if (wlen < spacing) continue;
    for (let t = spacing / 2; t < wlen; t += spacing) {
      for (const s of [1, -1]) {
        for (const side of [1, -1]) {
          const p = evalBelt(wall, t, s, side, true);
          if (!p) continue;
          const point: CityFreewaySidePoint = { ...p, side };
          if (withNext) {
            const n = evalBelt(wall, t + spacing, s, side, false);
            if (n) point.next = { x: n.x, y: n.y, z: n.z };
          }
          out.push(point);
        }
      }
    }
  }

  return out;
}
