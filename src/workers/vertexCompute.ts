/**
 * Shared vertex data computation module.
 * Imported by both terrain.worker.ts and spawn.worker.ts.
 *
 * Inlines: noise FBM, voronoi grid/Delaunay/walls/distance,
 * biome height functions, city grid logic.
 */

import Delaunator from "delaunator";
import Noise from "noise-ts";
import seedrandom from "seedrandom";

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

export interface WorldConfig {
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
    gridSize: number;
    roadWidth: number;
    blockCount: number;
  };
}

export interface VertexResult {
  height: number;
  biomeId: number;
  blend: number;
  distanceToBiomeBoundaryCenter: number;
  distanceToRiverCenter: number;
  distanceToRoadCenter: number;
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

const MASTER_SEED = "mynamebierce";

export const seedRand = (seed: any): number => seedrandom(seed + MASTER_SEED)();

const noiseInstance = new Noise(seedRand("bierce"));

const simplex2 = (x: number, y: number) => noiseInstance.simplex2(x, y);
const perlin2 = (x: number, y: number) => noiseInstance.perlin2(x, y);

const terrainNoise = (params: TerrainNoiseParams, x: number, y: number): number => {
  const xs = x / params.scale;
  const ys = y / params.scale;
  const G = 2.0 ** -params.persistence;
  let amplitude = 1.0;
  let frequency = 1.0;
  let normalization = 0;
  let total = 0;
  for (let o = 0; o < params.octaves; o++) {
    const noiseValue =
      params.type === "simplex"
        ? simplex2(xs * frequency, ys * frequency) * 0.5 + 0.5
        : perlin2(xs * frequency, ys * frequency) * 0.5 + 0.5;
    total += noiseValue * amplitude;
    normalization += amplitude;
    amplitude *= G;
    frequency *= params.lacunarity;
  }
  total /= normalization;
  total -= 0.5;
  return Math.pow(total, params.exponentiation) * params.height;
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

const getWalls = (
  seed: string,
  currentVertex: Vec2,
  grid: VGrid[],
  regionGrid: VGrid[],
  gridSize: number
): { biomeWalls: Wall[]; riverWalls: Wall[] } => {
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

  return { biomeWalls, riverWalls };
};

const distanceToWall = (px: number, py: number, walls: Wall[]): number => {
  let minDistSq = Infinity;
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
    if (distSq < minDistSq) minDistSq = distSq;
  }
  return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
};

// ══════════════════════════════════════════════════════════════════════
// City Grid (inlined from _city.ts)
// ══════════════════════════════════════════════════════════════════════

interface CityCell {
  pointX: number;
  pointY: number;
  blockIndex: number; // -1 for edge blocks
  isEdge: boolean;
  isCurrent: boolean;
  // neighbor flags
  isNorth: boolean;
  isEast: boolean;
  isSouth: boolean;
  isWest: boolean;
  isNE: boolean;
  isSE: boolean;
  isSW: boolean;
  isNW: boolean;
}

const cityCaches: { [seed: string]: { [gridKey: string]: CityCell[] } } = {};

const getCityGrid = (
  seed: string,
  vx: number,
  vy: number,
  cityGridSize: number,
  blockCount: number,
  walls: Wall[]
): CityCell[] => {
  const x = Math.floor(vx / cityGridSize);
  const y = Math.floor(vy / cityGridSize);

  if (!cityCaches[seed]) cityCaches[seed] = {};
  const cache = cityCaches[seed];
  const gridKey = `${x},${y}`;

  let grid: CityCell[] = cache[gridKey];
  if (!grid) {
    const diagThreshold = Math.sqrt(
      cityGridSize * 0.5 * cityGridSize * 0.5 + cityGridSize * 0.5 * cityGridSize * 0.5
    );

    grid = [];
    for (let ix = x - 2; ix <= x + 2; ix++) {
      for (let iy = y - 2; iy <= y + 2; iy++) {
        const px = ix * cityGridSize + 0.5 * cityGridSize;
        const py = iy * cityGridSize + 0.5 * cityGridSize;

        const isEdge = distanceToWall(px, py, walls) < diagThreshold;
        // Match _city.ts: JSON.stringify of {x, y} point for seed
        const blockIndex = isEdge ? -1 : Math.floor(seedRand(`${px},${py}`) * blockCount);

        grid.push({
          pointX: px,
          pointY: py,
          blockIndex,
          isEdge,
          isCurrent: ix === x && iy === y,
          isNorth: ix === x && iy === y + 1,
          isEast: ix === x + 1 && iy === y,
          isSouth: ix === x && iy === y - 1,
          isWest: ix === x - 1 && iy === y,
          isNE: ix === x + 1 && iy === y + 1,
          isSE: ix === x + 1 && iy === y - 1,
          isSW: ix === x - 1 && iy === y - 1,
          isNW: ix === x - 1 && iy === y + 1,
        });
      }
    }
    cache[gridKey] = grid;

    // Evict distant entries
    for (const key in cache) {
      const [cx, cy] = key.split(",").map(Number);
      if (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2) {
        delete cache[key];
      }
    }
  }
  return grid;
};

const getCityDistanceToRoad = (
  vx: number,
  vy: number,
  cityGridSize: number,
  cityRoadWidth: number,
  blockCount: number,
  walls: Wall[],
  citySeed: string
): number => {
  const grid = getCityGrid(citySeed, vx, vy, cityGridSize, blockCount, walls);

  let current: CityCell | undefined;
  let nBlock: number | undefined, eBlock: number | undefined, sBlock: number | undefined,
      wBlock: number | undefined, neBlock: number | undefined, seBlock: number | undefined,
      swBlock: number | undefined, nwBlock: number | undefined;

  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    if (c.isCurrent)     current = c;
    else if (c.isNorth)  nBlock  = c.blockIndex;
    else if (c.isEast)   eBlock  = c.blockIndex;
    else if (c.isSouth)  sBlock  = c.blockIndex;
    else if (c.isWest)   wBlock  = c.blockIndex;
    else if (c.isNE)     neBlock = c.blockIndex;
    else if (c.isSE)     seBlock = c.blockIndex;
    else if (c.isSW)     swBlock = c.blockIndex;
    else if (c.isNW)     nwBlock = c.blockIndex;
  }
  if (!current || current.isEdge) return 0;

  const x = Math.floor(vx / cityGridSize);
  const y = Math.floor(vy / cityGridSize);

  // Distances to cell boundaries
  const toN = (y + 1) * cityGridSize - vy;
  const toE = (x + 1) * cityGridSize - vx;
  const toS = vy - y * cityGridSize;
  const toW = vx - x * cityGridSize;
  const toNE = Math.max(toN, toE);
  const toSE = Math.max(toS, toE);
  const toSW = Math.max(toS, toW);
  const toNW = Math.max(toN, toW);

  const bi = current.blockIndex;
  return Math.min(
    nBlock !== bi ? toN : 999,
    eBlock !== bi ? toE : 999,
    sBlock !== bi ? toS : 999,
    wBlock !== bi ? toW : 999,
    neBlock !== bi ? toNE : 999,
    seBlock !== bi ? toSE : 999,
    swBlock !== bi ? toSW : 999,
    nwBlock !== bi ? toNW : 999
  );
};

// ══════════════════════════════════════════════════════════════════════
// Main Pipeline
// ══════════════════════════════════════════════════════════════════════

let cfg: WorldConfig | null = null;

export function initCompute(config: WorldConfig): void {
  cfg = config;
}

export function computeVertexData(x: number, z: number): VertexResult {
  if (!cfg) throw new Error("vertexCompute not initialized");

  // Step 1: Road noise offset
  const cvx = x + terrainNoise(cfg.roadNoiseParams, z, 0);
  const cvz = z + terrainNoise(cfg.roadNoiseParams, x, 0);
  const currentVertex: Vec2 = { x: cvx, y: cvz };

  // Step 2: Voronoi — region grid
  const regionGrid = getVoronoiGrid(
    `${cfg.seed} - regionGrid`,
    currentVertex,
    cfg.regions,
    cfg.regionGridSize,
    (point: Vec2, regions: SerializedRegion[]) => {
      const uuid = seedRand(`${point.x},${point.y}`);
      return regions[Math.floor(uuid * regions.length)];
    }
  );

  // Step 2b: Voronoi — biome grid (within regions)
  const biomeGrid = getVoronoiGrid(
    `${cfg.seed} - grid`,
    currentVertex,
    regionGrid,
    cfg.gridSize,
    (point: Vec2, rGrid: VGrid[]) => {
      const nearest = getNearestEntry(point, rGrid);
      const region: SerializedRegion = nearest.element;
      const uuid = seedRand(`${point.x},${point.y}`);
      return region.biomes[Math.floor(uuid * region.biomes.length)];
    }
  );

  // Step 2c: Get biome and distances
  const biome: SerializedBiome = getNearestEntry(currentVertex, biomeGrid).element;
  const { biomeWalls, riverWalls } = getWalls(
    cfg.seed,
    currentVertex,
    biomeGrid,
    regionGrid,
    cfg.gridSize
  );
  const distanceToBiomeBoundary = distanceToWall(cvx, cvz, biomeWalls);
  const distanceToRiver = distanceToWall(cvx, cvz, riverWalls);

  // Step 3: Blend
  const blendWidth = biome.blendWidth || cfg.defaultBlendWidth;
  const blend =
    Math.min(blendWidth, Math.max(distanceToBiomeBoundary - cfg.boundaryWidth, 0)) / blendWidth;

  // Step 4: Biome height
  let biomeHeight = 0;
  let distanceToRoadCenter = distanceToBiomeBoundary;

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
    } else if (cfg.cityConfig && biomeId === 1) {
      // City biome — compute internal road distance
      const cityDist = getCityDistanceToRoad(
        x,
        z,
        cfg.cityConfig.gridSize,
        cfg.cityConfig.roadWidth,
        cfg.cityConfig.blockCount,
        biomeWalls,
        cfg.cityConfig.seed
      );
      distanceToRoadCenter = Math.min(cityDist, distanceToRiver);
      const cityHeight = distanceToRoadCenter > cfg.cityConfig.roadWidth ? 10 : 0;
      biomeHeight = cityHeight * blend * riverFade;
    }
  }

  // Step 5: Base noise
  const height = biomeHeight + terrainNoise(cfg.baseNoiseParams, x, z);

  return {
    height,
    biomeId: biome.id,
    blend,
    distanceToBiomeBoundaryCenter: distanceToBiomeBoundary,
    distanceToRiverCenter: distanceToRiver,
    distanceToRoadCenter,
  };
}
