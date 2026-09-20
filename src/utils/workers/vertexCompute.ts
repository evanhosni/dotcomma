/**
 * THE height pipeline (CLAUDE.md: "Heights have a single source of truth"):
 * noise, voronoi, biome heights, city grid, flatten pads and the city feature
 * enumerators — run identically by every worker, the main thread and the server.
 */

import Delaunator from "delaunator";
import Noise from "noise-ts";
import { seedRand, smoothstep } from "../math/_math";
import type { PointXZ } from "../math/types";
import { CITY_BIOME_ID } from "../../world/constants";
import { densityCellRange, densityCellSize, densityProbability, passesPlacementFilters, rollDensityCell } from "./densityPlacement";

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
  flattenDescriptors?: FlattenDescriptor[];
}

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
  /** Real units; 99999 outside the city and in junction zones. */
  distanceToFreewayCenter: number;
  /** Lane-paint dash phase along that freeway; 0 outside. */
  freewayAlong: number;
}

/** A voronoi wall segment on the horizontal plane (warped space). */
interface Wall {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
}
interface VoronoiCell {
  point: PointXZ;
  element: any;
}

// ══════════════════════════════════════════════════════════════════════
// Noise
// ══════════════════════════════════════════════════════════════════════

const noiseInstance = new Noise(seedRand("bierce"));

const simplex2 = (x: number, y: number) => noiseInstance.simplex2(x, y);
const perlin2 = (x: number, y: number) => noiseInstance.perlin2(x, y);

// Memoized per params object: recomputing 2**-persistence per call added a pow per noise call.
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
  // Integer exponents skip pow() — identical results.
  const e = params.exponentiation;
  const shaped = e === 2 ? total * total : e === 1 ? total : Math.pow(total, e);
  return shaped * params.height;
};

// ══════════════════════════════════════════════════════════════════════
// Voronoi
// ══════════════════════════════════════════════════════════════════════

const voronoiCaches: { [seed: string]: { [gridKey: string]: any } } = {};

const getVoronoiGrid = (
  seed: string,
  currentVertex: PointXZ,
  cellArray: any[],
  gridSize: number,
  gridFunction: (point: PointXZ, array: any[]) => any
): VoronoiCell[] => {
  const x = Math.floor(currentVertex.x / gridSize);
  const z = Math.floor(currentVertex.z / gridSize);

  if (!voronoiCaches[seed]) voronoiCaches[seed] = {};
  const cache = voronoiCaches[seed];
  const gridKey = `${x},${z}`;

  // The jitter seeds are rolled IDENTICALLY by utils/voronoi/voronoi.worker.ts
  // (the main-thread biome lookup) and by getCityVoronoiSites below — change
  // all three together or the biome map disagrees with itself.
  let grid: VoronoiCell[] = cache[gridKey];
  if (!grid) {
    grid = [];
    for (let ix = x - 2; ix <= x + 2; ix++) {
      for (let iz = z - 2; iz <= z + 2; iz++) {
        const jitterX = seedRand(`${seed} - ${ix}X${iz}`);
        const jitterZ = seedRand(`${seed} - ${ix}Z${iz}`);
        const point: PointXZ = { x: (ix + jitterX) * gridSize, z: (iz + jitterZ) * gridSize };
        const element = gridFunction(point, cellArray);
        grid.push({ point, element });
      }
    }
    cache[gridKey] = grid;

    for (const key in cache) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(x - cx) > 5 || Math.abs(z - cz) > 5) {
        delete cache[key];
      }
    }
  }
  return grid;
};

const getNearestEntry = (point: PointXZ, grid: VoronoiCell[]): VoronoiCell => {
  let minDist = Infinity;
  let nearest = grid[0];
  for (let i = 0; i < grid.length; i++) {
    const dx = point.x - grid[i].point.x;
    const dz = point.z - grid[i].point.z;
    const d = dx * dx + dz * dz;
    if (d < minDist) {
      minDist = d;
      nearest = grid[i];
    }
  }
  return nearest;
};

const getTwoNearest = (px: number, pz: number, grid: VoronoiCell[]): [VoronoiCell, VoronoiCell] => {
  let min1 = Infinity;
  let min2 = Infinity;
  let idx1 = 0;
  let idx2 = 1;
  for (let i = 0; i < grid.length; i++) {
    const dx = px - grid[i].point.x;
    const dz = pz - grid[i].point.z;
    const d = dx * dx + dz * dz;
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

const delaunayCache = new WeakMap<
  VoronoiCell[],
  { delaunay: Delaunator<ArrayLike<number>>; circumcenters: number[] }
>();

const getDelaunayData = (grid: VoronoiCell[]) => {
  let cached = delaunayCache.get(grid);
  if (cached) return cached;

  const coords = new Float64Array(grid.length * 2);
  for (let i = 0; i < grid.length; i++) {
    coords[i * 2] = grid[i].point.x;
    coords[i * 2 + 1] = grid[i].point.z;
  }
  const delaunay = new Delaunator(coords);

  const circumcenters: number[] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const ai = delaunay.triangles[i];
    const bi = delaunay.triangles[i + 1];
    const ci = delaunay.triangles[i + 2];
    const ax = grid[ai].point.x,
      az = grid[ai].point.z;
    const bx = grid[bi].point.x,
      bz = grid[bi].point.z;
    const cx = grid[ci].point.x,
      cz = grid[ci].point.z;

    const ad = ax * ax + az * az;
    const bd = bx * bx + bz * bz;
    const cd = cx * cx + cz * cz;
    const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    circumcenters.push(
      (1 / D) * (ad * (bz - cz) + bd * (cz - az) + cd * (az - bz)),
      (1 / D) * (ad * (cx - bx) + bd * (ax - cx) + cd * (bx - ax))
    );
  }

  cached = { delaunay, circumcenters };
  delaunayCache.set(grid, cached);
  return cached;
};

// Memoized on grid identity: rebuilding the wall list per vertex (~900k string
// allocations per LOD1 chunk) was the dominant chunk-build cost. regionGrid is
// checked too in case gridSize ever stops dividing regionGridSize.
const wallsCache = new WeakMap<
  VoronoiCell[],
  { regionGrid: VoronoiCell[]; biomeWalls: Wall[]; riverWalls: Wall[] }
>();

const getWalls = (
  seed: string,
  currentVertex: PointXZ,
  grid: VoronoiCell[],
  regionGrid: VoronoiCell[],
  gridSize: number
): { biomeWalls: Wall[]; riverWalls: Wall[] } => {
  const memo = wallsCache.get(grid);
  if (memo && memo.regionGrid === regionGrid) return memo;

  const x = Math.floor(currentVertex.x / gridSize);
  const z = Math.floor(currentVertex.z / gridSize);

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
      v1z = circumcenters[t1 * 2 + 1];
    const v2x = circumcenters[t2 * 2],
      v2z = circumcenters[t2 * 2 + 1];

    const midX = (v1x + v2x) / 2;
    const midZ = (v1z + v2z) / 2;
    const label = `${Math.floor(midX)},${Math.floor(midZ)}`;

    if (cache[label] === undefined) {
      const [nearest1, nearest2] = getTwoNearest(midX, midZ, grid);
      const region1 = getNearestEntry(nearest1.point, regionGrid)?.element;
      const region2 = getNearestEntry(nearest2.point, regionGrid)?.element;

      cache[label] = {
        grid: [x, z],
        isRegionBoundary: region1 !== region2,
        isBiomeBoundary: !nearest1.element.joinable || nearest1.element !== nearest2.element,
      };

      for (const key in cache) {
        const cachedData = cache[key];
        if (cachedData.grid) {
          const [cx, cz] = cachedData.grid;
          if (Math.abs(x - cx) > 5 || Math.abs(z - cz) > 5) {
            delete cache[key];
          }
        }
      }
    }

    const wall: Wall = { sx: v1x, sz: v1z, ex: v2x, ez: v2z };

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

/** Pseudo-arc coordinate along the wall that won the last distanceToWall call
 *  (the belt freeway's dash phase). Jumps at wall joints — the shader's fwidth
 *  guard drops the paint there. */
let lastWallAlong = 0;

const distanceToWall = (px: number, pz: number, walls: Wall[]): number => {
  let minDistSq = Infinity;
  lastWallAlong = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const ddx = px - cx, ddz = pz - cz;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      lastWallAlong = t * Math.sqrt(lenSq) + w.sx + w.sz;
    }
  }
  return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
};

// ══════════════════════════════════════════════════════════════════════
// City (districts, block grid, shape features, arterials, belt)
// ══════════════════════════════════════════════════════════════════════

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

interface CityTerrain {
  roadDistance: number; // to the nearest road centerline, in street units
  relativeElevation: number; // relative to the regional base (computeVertexData adds it back)
  freewayDistance: number; // real units to the nearest freeway centerline (lane paint)
  freewayAlong: number; // dash-phase coordinate along that freeway
}

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

// The ×(roadWidth/freewayWidth) squash applies up to this normalized value (just
// past the interior band at 12), then the field recovers at the steep slope —
// without the recovery, blocks along every arterial stayed empty of buildings.
const CITY_ARTERIAL_RECOVER_NORM = 12.2;
const CITY_ARTERIAL_RECOVER_SLOPE = 3;

// Real units from a freeway centerline at which plateaus reach full height.
// Must stay inside the building setback (~35u) so block interiors are flat.
const CITY_FREEWAY_RAMP_END = 24;

// Road-constraint scratch buffers (distance + toward-road world direction); workers are single-threaded.
const roadConstraintDist = new Float64Array(24);
const roadConstraintDirX = new Float64Array(24);
const roadConstraintDirZ = new Float64Array(24);

// Every road feature is CONFINED to its own cell — that is what guarantees no tiny leftover pieces.
const CITY_SHAPE_SQUARE = 0;
const CITY_SHAPE_TRI_NE = 1; // diagonal road from the SW corner to the NE corner
const CITY_SHAPE_TRI_NW = 2; // diagonal road from the NW corner to the SE corner
const CITY_SHAPE_CIRCLE = 3; // circular block inside a roundabout ring road

// Roundabout ring-road centerline radius (× gridSize), centered on its 2×2
// super-cell: frac + roadWidth/gs must stay < 1.
const CITY_RING_RADIUS_FRAC = 0.825;

interface CityCell {
  /** Block index in [0, blockCount) for squares (same labels merge); a unique id
   *  (≥1000) for triangle/circle cells so roads always ring them; -1 = rim road. */
  label: number;
  shape: number;
}

/** A collision between adjacent special cells would only merge their boundary road — harmless. */
const cityUniqueLabel = (ix: number, iz: number): number =>
  1000 + ((((ix * 73856093) ^ (iz * 19349663)) >>> 0) % 1000000);

const superCellHasRoom = (sx: number, sz: number, walls: Wall[], d: CityDistrict): boolean => {
  const city = domainConfig!.cityConfig;
  const gs = city.gridSize;
  const w = cityLocalToWorld((2 * sx + 1) * gs, (2 * sz + 1) * gs, d);
  // ≥ every member cell's own rim check (cells go rim under 0.65·gs, centers sit ≤ 0.71·gs out).
  if (distanceToWall(w.x, w.z, walls) < gs * 1.6) return false;
  // Rotated super-cell extent (√2·gs) + the arterial road.
  return cityArterialDist(w.x, w.z, d) >= gs * 1.7;
};

/** The label a cell gets when it is NOT a roundabout member; null when it is.
 *  Non-recursive, so roundabout members can copy an outward neighbor's label. */
const baseCityLabel = (ix: number, iz: number, walls: Wall[], d: CityDistrict): number | null => {
  const city = domainConfig!.cityConfig;
  const gs = city.gridSize;
  const px = (ix + 0.5) * gs;
  const pz = (iz + 0.5) * gs;
  const w = cityLocalToWorld(px, pz, d);
  if (distanceToWall(w.x, w.z, walls) < gs * 0.15) return -1;
  const sx = Math.floor(ix / 2);
  const sz = Math.floor(iz / 2);
  const superRoll = seedRand(`${city.seed}-super-${d.key}|${sx},${sz}`);
  if (
    superRoll < city.roundaboutChance + city.triangleChance &&
    superCellHasRoom(sx, sz, walls, d)
  ) {
    if (superRoll < city.roundaboutChance) return null;
    return cityUniqueLabel(sx, sz);
  }
  return Math.floor(seedRand(`${d.key}|${px},${pz}`) * city.blockCount);
};

// Nested numeric maps: a flat string key allocated ~10 strings per city vertex on HITS.
interface CityCellStore {
  count: number;
  districts: Map<string, Map<number, Map<number, CityCell>>>;
}
const cityCellCaches: { [seed: string]: CityCellStore } = {};

const cityCellLookup = (store: CityCellStore, dKey: string, ix: number, iz: number): CityCell | undefined =>
  store.districts.get(dKey)?.get(ix)?.get(iz);

const getCityCell = (ix: number, iz: number, walls: Wall[], d: CityDistrict): CityCell => {
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
    const gs = city.gridSize;
    const px = (ix + 0.5) * gs;
    const pz = (iz + 0.5) * gs;
    const w = cityLocalToWorld(px, pz, d);
    // Only cells basically ON the boundary go full-road — the belt freeway owns the rim zone.
    if (distanceToWall(w.x, w.z, walls) < gs * 0.15) {
      cell = { label: -1, shape: CITY_SHAPE_SQUARE };
    } else {
      const sx = Math.floor(ix / 2);
      const sz = Math.floor(iz / 2);
      let superRoll = seedRand(`${city.seed}-super-${d.key}|${sx},${sz}`);
      if (
        superRoll < city.roundaboutChance + city.triangleChance &&
        !superCellHasRoom(sx, sz, walls, d)
      ) {
        superRoll = 1; // not enough room — fall through to a normal square
      }
      if (superRoll < city.roundaboutChance) {
        // Members COPY an outward neighbor's label so the wrap-around blocks merge
        // with the surrounding grid; differing copied labels become the streets
        // radiating from the ring (getCityTerrain suppresses them inside it).
        const nx = ix === 2 * sx ? 2 * sx - 1 : 2 * sx + 2; // outward x neighbor
        const nz = iz === 2 * sz ? 2 * sz - 1 : 2 * sz + 2; // outward z neighbor
        const copied = baseCityLabel(nx, iz, walls, d) ?? baseCityLabel(ix, nz, walls, d);
        cell = {
          label: copied ?? Math.floor(seedRand(`${d.key}|${px},${pz}`) * city.blockCount),
          shape: CITY_SHAPE_CIRCLE,
        };
      } else if (superRoll < city.roundaboutChance + city.triangleChance) {
        // One unique label across the super-cell guarantees boundary streets, so the diagonal ends in intersections.
        cell = {
          label: cityUniqueLabel(sx, sz),
          shape:
            seedRand(`${city.seed}-tri-${d.key}|${sx},${sz}`) < 0.5
              ? CITY_SHAPE_TRI_NE
              : CITY_SHAPE_TRI_NW,
        };
      } else {
        cell = {
          label: Math.floor(seedRand(`${d.key}|${px},${pz}`) * city.blockCount),
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
    col.set(iz, cell);
    store.count++;
  }
  return cell;
};

// Districts: jittered rows ~districtSize cells tall, split into staggered jittered
// segments. Each rotates its whole block grid by a seeded multiple of 15° about its
// center; district boundaries carry the arterial roads, which hide the grid seams.

const CITY_DISTRICT_JITTER = 0.4; // boundary jitter (× pitch): sizes ~0.6–1.4 × districtSize

const cityScalarCache = new Map<string, number>();
const cachedCityScalar = (key: string, compute: () => number): number => {
  let v = cityScalarCache.get(key);
  if (v === undefined) {
    if (cityScalarCache.size > 8192) dropOldestHalf(cityScalarCache);
    v = compute();
    cityScalarCache.set(key, v);
  }
  return v;
};

const cityDistrictPitch = (): number => domainConfig!.cityConfig.districtSize * domainConfig!.cityConfig.gridSize;

// Hottest scalar lookups (the find* loops probe them ≥4× per vertex): numeric keys so hits allocate nothing.
const cityRowBoundaryCache = new Map<number, number>();
/** Z of the boundary line between district rows k−1 and k. */
const cityRowBoundary = (k: number): number => {
  let v = cityRowBoundaryCache.get(k);
  if (v === undefined) {
    const pitch = cityDistrictPitch();
    v = (k + (seedRand(`${domainConfig!.cityConfig.seed}-drow-${k}`) - 0.5) * CITY_DISTRICT_JITTER) * pitch;
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
const CITY_WIGGLE_AMP = 38;
const CITY_WIGGLE_K1 = (2 * Math.PI) / 620;
const CITY_WIGGLE_K2 = (2 * Math.PI) / 260;

const cityWigglePhase = (tag: string, which: number): number =>
  cachedCityScalar(`wig${which}:${tag}`, () =>
    seedRand(`${domainConfig!.cityConfig.seed}-wig${which}-${tag}`) * Math.PI * 2
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
  pz: number;
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

const getCityDistrict = (vx: number, vz: number): CityDistrict => {
  const r = findCityRow(vz, vx);
  return cityDistrictByIndex(r, findCitySeg(r, vx, vz));
};

/** Axis-approximate distance to the district's wiggly arterial centerlines. */
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
const cityLocalToWorld = (lx: number, lz: number, d: CityDistrict): PointXZ => {
  const dx = lx - d.px;
  const dz = lz - d.pz;
  return { x: d.px + dx * d.cos - dz * d.sin, z: d.pz + dx * d.sin + dz * d.cos };
};

const getCityTerrain = (
  vx: number,
  vz: number,
  city: DomainConfig["cityConfig"],
  walls: Wall[],
  biomeBoundaryDist: number,
  biomeWallAlong: number
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
  const cellLabel = cell.label;
  // neighborLabels[(a+1)*3 + (b+1)] = label of cell (ix+a, iz+b)
  const neighborLabels: number[] = [];
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      neighborLabels[(a + 1) * 3 + (b + 1)] = getCityCell(ix + a, iz + b, walls, d).label;
    }
  }
  const n = neighborLabels[5]; // (0, +1)
  const e = neighborLabels[7]; // (+1, 0)
  const s = neighborLabels[3]; // (0, −1)
  const w = neighborLabels[1]; // (−1, 0)

  // Toward-road unit directions in the WORLD frame; NaN = pairable with anything (rim).
  let nCons = 0;
  const addLocalConstraint = (dd: number, lux: number, luz: number) => {
    if (nCons >= 24) return;
    roadConstraintDist[nCons] = dd;
    roadConstraintDirX[nCons] = lux * d.cos - luz * d.sin;
    roadConstraintDirZ[nCons] = lux * d.sin + luz * d.cos;
    nCons++;
  };
  const addWorldConstraint = (dd: number, wux: number, wuz: number) => {
    if (nCons >= 24) return;
    roadConstraintDist[nCons] = dd;
    roadConstraintDirX[nCons] = wux;
    roadConstraintDirZ[nCons] = wuz;
    nCons++;
  };

  // Inside the ring, boundary streets are suppressed so the members' internal
  // boundaries tee into the ring road instead of slicing the island.
  let circleR = Infinity;
  let ringR = 0;
  let circUx = 1; // unit direction from the ring center to the vertex (local)
  let circUz = 0;
  if (cell.shape === CITY_SHAPE_CIRCLE) {
    const scx = (2 * Math.floor(ix / 2) + 1) * gs;
    const scz = (2 * Math.floor(iz / 2) + 1) * gs;
    circleR = Math.hypot(lx - scx, lz - scz);
    ringR = gs * CITY_RING_RADIUS_FRAC;
    if (circleR > 1e-6) {
      circUx = (lx - scx) / circleR;
      circUz = (lz - scz) / circleR;
    }
  }
  const insideRing = circleR < ringR;

  if (!insideRing) {
    // Boundary SEGMENTS over the full 3×3 neighborhood, collinear runs MERGED.
    // Per-cell infinite lines were REJECTED (the chamfer's second constraint
    // popped identity at cell borders → notched road edges); unmerged collinear
    // segments were REJECTED (the chamfer paired two pieces of the SAME road →
    // notched sidewalks at every merged-block seam).
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
  }

  // In-super-cell shape features (each confined to its own 2×2 super-cell):
  if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
    // Diagonal road corner-to-corner across the 2×2 super-cell.
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
    // Island field compressed ×0.75 so buildings keep a margin from the curved curb.
    if (insideRing) addLocalConstraint((ringR - circleR) * 0.75, circUx, circUz);
    else addLocalConstraint(circleR - ringR, -circUx, -circUz);
  }

  // Arterials are WORLD-aligned (only district interiors rotate) and normalized
  // into street units so ONE road field drives shader bands, curb dip and spawn filters.
  const freewayToStreetScale = city.roadWidth / city.freewayWidth;
  const arterialSouth = vz - cityRowEdgeZ(d.r, vx);
  const arterialNorth = cityRowEdgeZ(d.r + 1, vx) - vz;
  const arterialWest = vx - citySegEdgeX(d.r, d.m, vz);
  const arterialEast = citySegEdgeX(d.r, d.m + 1, vz) - vx;
  let arterialReal = arterialSouth;
  let aUx = 0;
  let aUz = -1;
  let arterialAlong = vx; // row boundaries run along x
  if (arterialNorth < arterialReal) {
    arterialReal = arterialNorth;
    aUx = 0;
    aUz = 1;
    arterialAlong = vx;
  }
  if (arterialWest < arterialReal) {
    arterialReal = arterialWest;
    aUx = -1;
    aUz = 0;
    arterialAlong = vz; // segment boundaries run along z
  }
  if (arterialEast < arterialReal) {
    arterialReal = arterialEast;
    aUx = 1;
    aUz = 0;
    arterialAlong = vz;
  }
  arterialReal = Math.max(0, arterialReal);
  // See CITY_ARTERIAL_RECOVER_NORM; max() of the two slopes keeps the field continuous.
  const recoverNorm = CITY_ARTERIAL_RECOVER_NORM;
  addWorldConstraint(
    Math.max(
      arterialReal * freewayToStreetScale,
      (arterialReal - recoverNorm / freewayToStreetScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm
    ),
    aUx,
    aUz
  );

  // BELT freeway: centerline boundaryWidth + freewayWidth inside the biome boundary
  // (outer edge abuts the boundary band). No direction — the boundary curves — so
  // it pairs with anything in the chamfer.
  const beltReal = Math.abs(biomeBoundaryDist - (domainConfig!.boundaryWidth + city.freewayWidth));
  addWorldConstraint(
    Math.max(
      beltReal * freewayToStreetScale,
      (beltReal - recoverNorm / freewayToStreetScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm
    ),
    NaN,
    0
  );

  // Bilinear plateau interpolation toward the neighbors the vertex leans into (same label → same height → no seam).
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
  const hD = cityBlockElevation(
    city.seed,
    getCityCell(ix + dxi, iz + dzi, walls, d).label,
    city.maxBlockElevation
  );
  let elevation =
    hC * (1 - wx) * (1 - wz) + hX * wx * (1 - wz) + hZ * (1 - wx) * wz + hD * wx * wz;

  // Freeways sit at MID-PLATEAU grade so elevation stays continuous across the
  // district switch. Grade 0 with a tight ramp was REJECTED: every freeway read
  // as a V trough.
  const freewayGrade = city.maxBlockElevation * 0.5;
  const freewayRamp =
    smoothstep(2, CITY_FREEWAY_RAMP_END, arterialReal) *
    smoothstep(2, CITY_FREEWAY_RAMP_END, beltReal);
  elevation = freewayGrade + (elevation - freewayGrade) * freewayRamp;

  // Roundabout island: its own flat plateau, blended in under the inner ring road.
  if (insideRing) {
    const islandH = cityBlockElevation(
      city.seed,
      cityUniqueLabel(Math.floor(ix / 2), Math.floor(iz / 2)),
      city.maxBlockElevation
    );
    const islandMask = 1 - smoothstep(ringR - 12, ringR - 2, circleR);
    elevation += (islandH - elevation) * islandMask;
  }

  // Pairwise LINEAR chamfer/melt: (dᵢ + dⱼ) is constant along straight lines, so
  // corners get 45° cuts and pinched fragments become road. Fully pairwise (no
  // argmin identity switches) and linear — a smoothstep-SCALED melt was
  // REJECTED: it rounded every block into a blob.
  let nearestConstraint = 99;
  for (let i = 0; i < nCons; i++) if (roadConstraintDist[i] < nearestConstraint) nearestConstraint = roadConstraintDist[i];
  let chamfer = 99;
  for (let i = 0; i < nCons; i++) {
    for (let j = i + 1; j < nCons; j++) {
      let pen = 0;
      if (!Number.isNaN(roadConstraintDirX[i]) && !Number.isNaN(roadConstraintDirX[j])) {
        const dot = roadConstraintDirX[i] * roadConstraintDirX[j] + roadConstraintDirZ[i] * roadConstraintDirZ[j];
        pen = CITY_CHAMFER_DOT_PENALTY * smoothstep(CITY_CHAMFER_DOT_LO, CITY_CHAMFER_DOT_HI, dot);
      }
      const c = (roadConstraintDist[i] + roadConstraintDist[j] + pen) * CITY_CHAMFER_SCALE;
      if (c < chamfer) chamfer = c;
    }
  }
  let roadDistance = Math.min(nearestConstraint, chamfer);

  if (cellLabel < 0) roadDistance = 0; // biome-edge cells are all road (the rim ring road)

  elevation -= city.curbHeight * (1 - smoothstep(city.roadWidth - 2, city.roadWidth, roadDistance));

  // Lane paint. JUNCTION ZONES (a second freeway feature within reach) export
  // "no paint" so lines end cleanly before interchanges.
  let freewayDistance = arterialReal;
  let freewayAlong = arterialAlong;
  if (beltReal < freewayDistance) {
    freewayDistance = beltReal;
    freewayAlong = biomeWallAlong;
  }
  let m1 = 99999;
  let m2 = 99999;
  for (const v of [Math.max(0, arterialSouth), Math.max(0, arterialNorth), Math.max(0, arterialWest), Math.max(0, arterialEast), beltReal]) {
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

  return { roadDistance, relativeElevation: elevation, freewayDistance, freewayAlong };
};

// ══════════════════════════════════════════════════════════════════════
// Flatten-ground pads (actors with flattenGround: true)
// ══════════════════════════════════════════════════════════════════════
// Spawn points need terrain height and the terrain now depends on spawn points;
// resolved by FULLY DETERMINISTIC placement both consumers share: candidates roll
// the exact spawn.worker seeds/filters against the RAW height (recursion guard),
// spacing is stateless per canonical tile, and spawn.worker sources flattenGround
// points FROM getFlattenPoints. See CLAUDE.md "Flatten-ground pads".

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

/** Maps iterate in insertion order (≈ proximity to the player), so this evicts
 *  the far half. clear() was REJECTED: a flatten tile costs 30–70ms to rebuild
 *  and a full clear flooded the next queries. */
const dropOldestHalf = <K, V>(map: Map<K, V>): void => {
  let remaining = map.size >> 1;
  for (const key of map.keys()) {
    if (remaining-- <= 0) break;
    map.delete(key);
  }
};

const flattenTileCache = new Map<string, FlattenPoint[]>();
// Boundary cells are shared by overlapping tile windows (~2.2× re-evaluation without this). null = rolled/filtered out.
const flattenCandCache = new Map<string, FlattenCandidate | null>();
let flattenReach = 0; // max(radius + skirt) — vertex lookup reach
let flattenSpacingPad = 0; // max footprint — spacing window pad
let flattenBiomes: Set<number> | null = null; // union of descs' biomeIds; null = unrestricted
let evaluatingPadCandidates = false; // recursion guard: candidate filters use RAW height

/** Pad-free — for sparse scans that would otherwise compute a pad tile per lonely sample. */
export function computeVertexDataRaw(x: number, z: number): VertexResult {
  evaluatingPadCandidates = true;
  try {
    return computeVertexData(x, z);
  } finally {
    evaluatingPadCandidates = false;
  }
}

/** Accepted flatten points whose center lies in the tile — canonical, so every caller sees the identical set. */
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

  const descs = domainConfig!.flattenDescriptors!;
  const candidates: FlattenCandidate[] = [];
  evaluatingPadCandidates = true;
  try {
    for (let di = 0; di < descs.length; di++) {
      const desc = descs[di];
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
            const vd = computeVertexData(roll.x, roll.z); // RAW (evaluatingPadCandidates guard)
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
    evaluatingPadCandidates = false;
  }

  // Iterated LOCAL spacing (Matérn-II rounds): a candidate is rejected by any
  // earlier-ordered POOL member within its footprint — purely local, so tiles
  // agree (greedy against ACCEPTED points was REJECTED: acceptance chains crossed
  // tile windows). One round packs ~45% of greedy; the re-entry rounds converge.
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

export function getFlattenPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): FlattenPoint[] {
  if (!domainConfig || !domainConfig.flattenDescriptors || domainConfig.flattenDescriptors.length === 0) return [];
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

// Influences apply in ASCENDING mask order so the dominant pad lands last (a
// dense neighbor's skirt otherwise tilted the footing). Parallel reused buffers,
// almost always ≤3 entries — an object per influence was steady GC churn.
const padInfluenceHeights: number[] = [];
const padInfluenceMasks: number[] = [];
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
          (padInfluenceMasks[j - 1] > mask || (padInfluenceMasks[j - 1] === mask && padInfluenceHeights[j - 1] > p.y))
        ) {
          padInfluenceMasks[j] = padInfluenceMasks[j - 1];
          padInfluenceHeights[j] = padInfluenceHeights[j - 1];
          j--;
        }
        padInfluenceMasks[j] = mask;
        padInfluenceHeights[j] = p.y;
      }
    }
  }
  for (let i = 0; i < infCount; i++) {
    height += (padInfluenceHeights[i] - height) * padInfluenceMasks[i];
  }
  return height;
};

// ══════════════════════════════════════════════════════════════════════
// Main Pipeline
// ══════════════════════════════════════════════════════════════════════

let domainConfig: DomainConfig | null = null;

export function initCompute(config: DomainConfig): void {
  domainConfig = config;
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

const regionGridFn = (point: PointXZ, regions: SerializedRegion[]) => {
  const uuid = seedRand(`${point.x},${point.z}`);
  return regions[Math.floor(uuid * regions.length)];
};

const biomeGridFn = (point: PointXZ, rGrid: VoronoiCell[]) => {
  const nearest = getNearestEntry(point, rGrid);
  const region: SerializedRegion = nearest.element;
  const uuid = seedRand(`${point.x},${point.z}`);
  return region.biomes[Math.floor(uuid * region.biomes.length)];
};

const getBiomeContext = (currentVertex: PointXZ) => {
  const regionGrid = getVoronoiGrid(
    `${domainConfig!.seed} - regionGrid`,
    currentVertex,
    domainConfig!.regions,
    domainConfig!.regionGridSize,
    regionGridFn
  );
  const biomeGrid = getVoronoiGrid(
    `${domainConfig!.seed} - grid`,
    currentVertex,
    regionGrid,
    domainConfig!.gridSize,
    biomeGridFn
  );
  const biome: SerializedBiome = getNearestEntry(currentVertex, biomeGrid).element;
  const { biomeWalls, riverWalls } = getWalls(
    domainConfig!.seed,
    currentVertex,
    biomeGrid,
    regionGrid,
    domainConfig!.gridSize
  );
  return { biome, biomeWalls, riverWalls };
};

export function computeVertexData(x: number, z: number): VertexResult {
  if (!domainConfig) throw new Error("vertexCompute not initialized");

  // Step 1: Road noise offset
  const cvx = x + terrainNoise(domainConfig.roadNoiseParams, z, 0);
  const cvz = z + terrainNoise(domainConfig.roadNoiseParams, x, 0);
  const currentVertex: PointXZ = { x: cvx, z: cvz };

  // Step 2: Voronoi — region grid, biome grid, walls
  const { biome, biomeWalls, riverWalls } = getBiomeContext(currentVertex);
  const distanceToBiomeBoundary = distanceToWall(cvx, cvz, biomeWalls);
  const biomeWallAlong = lastWallAlong; // capture before the river call overwrites
  const distanceToRiver = distanceToWall(cvx, cvz, riverWalls);

  // Step 3: Blend
  const blendWidth = biome.blendWidth || domainConfig.defaultBlendWidth;
  const blend =
    Math.min(blendWidth, Math.max(distanceToBiomeBoundary - domainConfig.boundaryWidth, 0)) / blendWidth;

  // Step 4: Biome height
  const baseHeight = terrainNoise(domainConfig.baseNoiseParams, x, z);
  let biomeHeight = 0;
  let distanceToRoadCenter = distanceToBiomeBoundary;
  let distanceToFreewayCenter = 99999;
  let freewayAlong = 0;

  if (distanceToRiver > domainConfig.riverWidth) {
    const riverFade = Math.min(1.0, (distanceToRiver - domainConfig.riverWidth) / domainConfig.riverWidth);
    const biomeId = biome.id;
    const noiseConfig = domainConfig.biomeNoiseConfigs[biomeId];

    if (noiseConfig) {
      let h = terrainNoise(noiseConfig.params, x, z);
      if (noiseConfig.absNeg) h = Math.abs(h) * -1;
      if (noiseConfig.scale !== undefined) h *= noiseConfig.scale;
      if (noiseConfig.offset !== undefined) h += noiseConfig.offset;
      biomeHeight = h * blend * riverFade;
    } else if (domainConfig.cityConfig && biomeId === CITY_BIOME_ID) {
      const city = getCityTerrain(x, z, domainConfig.cityConfig, biomeWalls, distanceToBiomeBoundary, biomeWallAlong);
      distanceToRoadCenter = Math.min(city.roadDistance, distanceToRiver);
      distanceToFreewayCenter = city.freewayDistance;
      freewayAlong = city.freewayAlong;
      // The city RIDES the regional base noise; flat footing comes from the pads (see CLAUDE.md).
      biomeHeight = city.relativeElevation * blend * riverFade;
    }
  }

  // Step 5: Base noise
  let height = biomeHeight + baseHeight;

  // Step 6: flatten pads — skipped while evaluating pad candidates (defined
  // against the RAW terrain) and in biomes no flatten descriptor targets.
  if (
    !evaluatingPadCandidates &&
    domainConfig.flattenDescriptors &&
    domainConfig.flattenDescriptors.length > 0 &&
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

const cityCellAtLocal = (ix: number, iz: number, d: CityDistrict): CityCell => {
  // Cache-first: the walls/noise context costs 2 FBMs + a voronoi lookup, and
  // paying it on HITS made this the dominant cost of the dressing enumerations.
  const city = domainConfig!.cityConfig;
  const store = cityCellCaches[city.seed];
  const cached = store && cityCellLookup(store, d.key, ix, iz);
  if (cached) return cached;

  const gs = city.gridSize;
  const w = cityLocalToWorld((ix + 0.5) * gs, (iz + 0.5) * gs, d);
  const warped: PointXZ = {
    x: w.x + terrainNoise(domainConfig!.roadNoiseParams, w.z, 0),
    z: w.z + terrainNoise(domainConfig!.roadNoiseParams, w.x, 0),
  };
  return getCityCell(ix, iz, getBiomeContext(warped).biomeWalls, d);
};

/** District-frame AABB of the chunk∩district overlap (padded by the wiggle amplitude); null when disjoint. */
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

/** Ownership by world position (deterministic per district / global lattices
 *  for arterials) keeps chunked calls duplicate-free. */
export function getCityRoadMarkers(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): RoadMarkerPoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const gs = city.gridSize;
  const out: RoadMarkerPoint[] = [];

  const emitIfOnRoadCenter = (mx: number, mz: number, dirX: number, dirZ: number) => {
    const vd = computeVertexData(mx, mz);
    if (vd.biomeId !== CITY_BIOME_ID) return; // city biome only
    if (vd.distanceToRiverCenter < 45) return;
    if (vd.distanceToRoadCenter > 2) return; // melted/chamfered zones drop out
    // Strictly INSIDE the belt ring, one-sided: an abs-window corridor check
    // LEAKED markers into the strip between the belt and the biome boundary.
    if (
      vd.distanceToBiomeBoundaryCenter <
      domainConfig!.boundaryWidth + city.freewayWidth * 2 + 5
    )
      return;
    out.push({ x: mx, y: vd.height, z: mz, dirX, dirZ });
  };

  // Per district: enumerate in the LOCAL frame, rotate out, own by world
  // position, clip to the wiggly district. Index ranges padded ±1 for the wiggle.
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const rows0 = findCityRow(minZ, midX) - 1;
  const rows1 = findCityRow(maxZ - 0.001, midX) + 1;
  for (let r = rows0; r <= rows1; r++) {
    const m0 = findCitySeg(r, minX, midZ) - 1;
    const m1 = findCitySeg(r, maxX - 0.001, midZ) + 1;
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);

      const cellAt = (ix: number, iz: number): CityCell => cityCellAtLocal(ix, iz, d);

      const emitLocalMarker = (lmx: number, lmz: number, ldx: number, ldz: number) => {
        const p = cityLocalToWorld(lmx, lmz, d);
        if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) return; // chunk ownership
        if (getCityDistrict(p.x, p.z).key !== d.key) return; // district clip (wiggly edges)
        if (cityArterialDist(p.x, p.z, d) < city.freewayWidth + 5) return; // stop at arterials
        emitIfOnRoadCenter(p.x, p.z, ldx * d.cos - ldz * d.sin, ldx * d.sin + ldz * d.cos);
      };

      // A boundary marker sits on a cell edge — test the cell and its west/south neighbors too.
      const insideRoundabout = (lmx: number, lmz: number): boolean => {
        const cx = Math.floor(lmx / gs);
        const cz = Math.floor(lmz / gs);
        for (const [ix, iz] of [
          [cx, cz],
          [cx - 1, cz],
          [cx, cz - 1],
        ]) {
          if (cellAt(ix, iz).shape !== CITY_SHAPE_CIRCLE) continue;
          const sx = Math.floor(ix / 2);
          const sz = Math.floor(iz / 2);
          const rr = Math.hypot(lmx - (2 * sx + 1) * gs, lmz - (2 * sz + 1) * gs);
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
        for (let iz = iy0; iz <= iy1; iz++) {
          const cell = cellAt(ix, iz);
          const curL = cell.label;

          // East boundary: x = (ix+1)·gs, z ∈ [iz·gs, (iz+1)·gs]
          if (cellAt(ix + 1, iz).label !== curL) {
            const bx = (ix + 1) * gs;
            for (let z = iz * gs + inset; z <= (iz + 1) * gs - inset; z += streetSpacing) {
              if (insideRoundabout(bx, z)) continue;
              emitLocalMarker(bx, z, 0, 1);
            }
          }

          // North boundary: z = (iz+1)·gs, x ∈ [ix·gs, (ix+1)·gs]
          if (cellAt(ix, iz + 1).label !== curL) {
            const bz = (iz + 1) * gs;
            for (let x = ix * gs + inset; x <= (ix + 1) * gs - inset; x += streetSpacing) {
              if (insideRoundabout(x, bz)) continue;
              emitLocalMarker(x, bz, 1, 0);
            }
          }

          if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
            // Emitted from the super-cell's anchor cell only.
            const sx = Math.floor(ix / 2);
            const sz = Math.floor(iz / 2);
            if (ix !== 2 * sx || iz !== 2 * sz) continue;
            const side = 2 * gs;
            const diagLen = side * Math.SQRT2;
            const dirX = Math.SQRT1_2;
            const dirZ = cell.shape === CITY_SHAPE_TRI_NE ? Math.SQRT1_2 : -Math.SQRT1_2;
            const startX = 2 * sx * gs;
            const startZ = cell.shape === CITY_SHAPE_TRI_NE ? 2 * sz * gs : 2 * sz * gs + side;
            const diagInset = inset * Math.SQRT1_2 + city.roadWidth;
            for (let t = diagInset; t <= diagLen - diagInset; t += streetSpacing) {
              emitLocalMarker(startX + dirX * t, startZ + dirZ * t, dirX, dirZ);
            }
          } else if (cell.shape === CITY_SHAPE_CIRCLE) {
            // Emitted from the super-cell's anchor cell only; markers ring the island tangentially.
            const sx = Math.floor(ix / 2);
            const sz = Math.floor(iz / 2);
            if (ix !== 2 * sx || iz !== 2 * sz) continue;
            const scx = (2 * sx + 1) * gs;
            const scz = (2 * sz + 1) * gs;
            const ringR = gs * CITY_RING_RADIUS_FRAC;
            const count = Math.max(8, Math.round((2 * Math.PI * ringR) / streetSpacing));
            for (let i = 0; i < count; i++) {
              const a = (i / count) * 2 * Math.PI;
              emitLocalMarker(scx + Math.cos(a) * ringR, scz + Math.sin(a) * ringR, -Math.sin(a), Math.cos(a));
            }
          }
        }
      }
    }
  }

  // Arterial centerlines: markers on GLOBAL parameter lattices (duplicate-free across chunks), oriented along the wiggle tangent.
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
      emitIfOnRoadCenter(mx, mz, 1 / norm, slope / norm);
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
        emitIfOnRoadCenter(mx, mz, slope / norm, 1 / norm);
      }
    }
  }

  // Belt median markers: step along the biome WALL segments in warped space,
  // offset ±beltR, invert the road-noise warp; off-city candidates die in the filters.
  const beltR = domainConfig.boundaryWidth + city.freewayWidth;
  const wcx = (minX + maxX) / 2;
  const wcz = (minZ + maxZ) / 2;
  const beltWalls = getBiomeContext({
    x: wcx + terrainNoise(domainConfig.roadNoiseParams, wcz, 0),
    z: wcz + terrainNoise(domainConfig.roadNoiseParams, wcx, 0),
  }).biomeWalls;
  for (const wall of beltWalls) {
    // getWalls emits each wall twice endpoint-swapped — canonical orientation only.
    if (wall.ex < wall.sx || (wall.ex === wall.sx && wall.ez < wall.sz)) continue;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ez - wall.sz;
    const wlen = Math.hypot(wdx, wdz);
    if (wlen < freewaySpacing) continue;
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    for (let t = freewaySpacing / 2; t < wlen; t += freewaySpacing) {
      for (const side of [1, -1]) {
        const twx = wall.sx + ux * t - uz * beltR * side;
        const twz = wall.sz + uz * t + ux * beltR * side;
        // Invert the road-noise warp by fixed-point iteration (smooth, large-scale warp).
        let mx = twx;
        let mz = twz;
        for (let it = 0; it < 3; it++) {
          mx = twx - terrainNoise(domainConfig.roadNoiseParams, mz, 0);
          mz = twz - terrainNoise(domainConfig.roadNoiseParams, mx, 0);
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

/** The jittered voronoi SITE of every biome-grid cell in the bounds that rolled
 *  the city biome (same seeds as getVoronoiGrid), warp-inverted to real world space. */
export function getCityVoronoiSites(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): CitySitePoint[] {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const gs = domainConfig.gridSize;
  const seed = `${domainConfig.seed} - grid`;
  const out: CitySitePoint[] = [];
  // Pad one cell ring: the warp shifts sites by less than a cell.
  const ix0 = Math.floor(minX / gs) - 1;
  const ix1 = Math.floor(maxX / gs) + 1;
  const iy0 = Math.floor(minZ / gs) - 1;
  const iy1 = Math.floor(maxZ / gs) + 1;

  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iy0; iz <= iy1; iz++) {
      const jitterX = seedRand(`${seed} - ${ix}X${iz}`);
      const jitterZ = seedRand(`${seed} - ${ix}Z${iz}`);
      const site: PointXZ = { x: (ix + jitterX) * gs, z: (iz + jitterZ) * gs };
      const regionGrid = getVoronoiGrid(
        `${domainConfig.seed} - regionGrid`,
        site,
        domainConfig.regions,
        domainConfig.regionGridSize,
        regionGridFn
      );
      const biome: SerializedBiome = biomeGridFn(site, regionGrid);
      if (biome.id !== 1) continue;
      // Invert the road-noise warp (fixed point — same as the belt markers)
      let wx = site.x;
      let wz = site.z;
      for (let it = 0; it < 3; it++) {
        wx = site.x - terrainNoise(domainConfig.roadNoiseParams, wz, 0);
        wz = site.z - terrainNoise(domainConfig.roadNoiseParams, wx, 0);
      }
      // RAW height: the beacon floats heightOffset above anyway, and the padded path would build a pad tile per site.
      out.push({ key: `${ix},${iz}`, x: wx, y: computeVertexDataRaw(wx, wz).height, z: wz });
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
  const beltR = domainConfig.boundaryWidth + city.freewayWidth;
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
        for (let iz = iy0; iz <= iy1; iz++) {
          // Corner at local (ix·gs, iz·gs); the four cells around it.
          const A = cityCellAtLocal(ix - 1, iz - 1, d);
          const B = cityCellAtLocal(ix, iz - 1, d);
          const C = cityCellAtLocal(ix - 1, iz, d);
          const D = cityCellAtLocal(ix, iz, d);
          // Rim cells and roundabout territory never get signals.
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
              if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < 45) break;
              // Strictly inside the belt ring, one-sided (see the road markers).
              if (vd.distanceToBiomeBoundaryCenter < beltR + city.freewayWidth + 5)
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

/** Points `lateral` real units to both sides of every freeway centerline
 *  (arterials + belt), `spacing` apart, with the tangent direction. Candidates
 *  near a crossing freeway (junctionClear) or melted into road drop out. With
 *  `withNext` each point carries its successor so wires span chunk borders.
 *  Belt candidates depend on the query center's wall set — keep chunk size consistent. */
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
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const freewayToStreetScale = city.roadWidth / city.freewayWidth;
  const beltR = domainConfig.boundaryWidth + city.freewayWidth;
  const minField = lateral * freewayToStreetScale - 1.5; // reject points melted into road
  const out: CityFreewaySidePoint[] = [];

  type Candidate = { x: number; y: number; z: number; dirX: number; dirZ: number } | null;

  // Ownership BEFORE validation: the belt scan visits every nearby wall for every
  // city chunk, and validating unowned candidates made builds ~10× slower.
  // Next-link lookups skip it — a successor usually lives in the neighbor chunk.
  const chunkOwns = (px: number, pz: number): boolean =>
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
    if (owned && !chunkOwns(px, pz)) return null;
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
    // Scan padded by `lateral`: the side offset shifts a point up to lateral·slope along the row.
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

  const evalSeg = (r: number, m: number, j: number, side: number, owned: boolean): Candidate => {
    const mz = j * spacing;
    const mx = citySegEdgeX(r, m, mz);
    const slope = cityWiggleSlope(`s${r}:${m}`, mz);
    const norm = Math.hypot(1, slope);
    const ux = slope / norm;
    const uz = 1 / norm;
    const px = mx - uz * lateral * side;
    const pz = mz + ux * lateral * side;
    if (owned && !chunkOwns(px, pz)) return null;
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

  // Belt: same wall-stepping + warp inversion as the belt median markers; side +1 = the city side.
  const wcx = (minX + maxX) / 2;
  const wcz = (minZ + maxZ) / 2;
  const beltWalls = getBiomeContext({
    x: wcx + terrainNoise(domainConfig.roadNoiseParams, wcz, 0),
    z: wcz + terrainNoise(domainConfig.roadNoiseParams, wcx, 0),
  }).biomeWalls;
  const evalBelt = (wall: Wall, t: number, s: number, side: number, owned: boolean): Candidate => {
    if (t <= 0 || t >= Math.hypot(wall.ex - wall.sx, wall.ez - wall.sz)) return null;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ez - wall.sz;
    const wlen = Math.hypot(wdx, wdz);
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    const o = beltR + side * lateral;
    const twx = wall.sx + ux * t - uz * o * s;
    const twz = wall.sz + uz * t + ux * o * s;
    let mx = twx;
    let mz = twz;
    for (let it = 0; it < 3; it++) {
      mx = twx - terrainNoise(domainConfig!.roadNoiseParams, mz, 0);
      mz = twz - terrainNoise(domainConfig!.roadNoiseParams, mx, 0);
    }
    if (owned && !chunkOwns(mx, mz)) return null;
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
    if (wall.ex < wall.sx || (wall.ex === wall.sx && wall.ez < wall.sz)) continue;
    const wlen = Math.hypot(wall.ex - wall.sx, wall.ez - wall.sz);
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
