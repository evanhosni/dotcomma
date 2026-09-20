import Delaunator from "delaunator";
import type { PointXZ } from "../math/types";
import { Biome, Region } from "../../world/types";
import { _math } from "../math/_math";
import { TaskQueue } from "../task-queue/TaskQueue";
import {
  VORONOI_FUNCTION,
  VoronoiCreateParams,
  VoronoiGetDistanceToWallParams,
  VoronoiGetGridParams,
  VoronoiGetWallsParams,
  VoronoiGrid,
  VoronoiWall,
} from "./types";

// The low-rate main-thread biome lookup (Skybox / stats overlay). The terrain
// pipeline runs the same algorithm inlined in utils/workers/vertexCompute.ts;
// the two MUST roll identical jitter seeds (`${seed} - ${ix}X${iz}` / `${ix}Z${iz}`).

interface MessageData {
  type: VORONOI_FUNCTION;
  params: VoronoiCreateParams | VoronoiCreateParams[] | VoronoiGetDistanceToWallParams;
}

const gridCachesBySeed: any = {};
const taskQueue = new TaskQueue();

self.onmessage = function (event: MessageEvent<MessageData>) {
  taskQueue.addTask(() => handleTask(event.data));
};

async function handleTask(task: MessageData) {
  const { type, params } = task;

  const classifyPoint = (params: VoronoiCreateParams) => {
    const { seed, currentVertex, regionGridSize, regions, gridSize, biomes } = params as VoronoiCreateParams;
    const vertex: PointXZ = { x: currentVertex.x, z: currentVertex.z };

    let grid: VoronoiGrid[] = [];
    let regionGrid: VoronoiGrid[] = [];

    if (regionGridSize && regions?.length) {
      regionGrid = getGrid({
        seed: `${seed} - regionGrid`,
        currentVertex: vertex,
        cellArray: regions,
        gridSize: regionGridSize,
        gridFunction: (point: PointXZ, regions: Region[]): Region => {
          let uuid = _math.seedRand(`${point.x},${point.z}`);
          let region = regions[Math.floor(uuid * regions.length)];
          return region;
        },
      });

      grid = getGrid({
        seed: `${seed} - grid`,
        currentVertex: vertex,
        cellArray: regionGrid,
        gridSize: gridSize,
        gridFunction: (point: PointXZ, grid: VoronoiGrid[]): Biome => {
          const nearest = getNearestEntry(point, grid);
          const region: Region = nearest.element;
          let uuid = _math.seedRand(`${point.x},${point.z}`);
          let biome = region.biomes[Math.floor(uuid * region.biomes.length)];
          return biome;
        },
      });
    } else if (biomes?.length) {
      grid = getGrid({
        seed: `${seed} - grid`,
        currentVertex: vertex,
        cellArray: biomes!,
        gridSize: gridSize,
        gridFunction: (point: PointXZ, biomes: Biome[]): Biome => {
          let uuid = _math.seedRand(`${point.x},${point.z}`);
          let biome = biomes[Math.floor(uuid * biomes.length)];
          return biome;
        },
      });
    }

    const region = getCurrentRegion(vertex, regionGrid);
    const regionSite = getCurrentRegionSite(vertex, regionGrid);
    const biome = getCurrentBiome(vertex, grid);
    const biomeSite = getCurrentBiomeSite(vertex, grid);

    const { biomeWalls, riverWalls } = getWalls({
      seed: `${seed} - walls`,
      currentVertex: vertex,
      grid,
      regionGrid,
      gridSize,
    });

    const distanceToBiomeBoundary = getDistanceToWall({ currentVertex: vertex, walls: biomeWalls });
    const distanceToRiver = getDistanceToWall({ currentVertex: vertex, walls: riverWalls });

    return {
      currentVertex,
      grid,
      region,
      regionSite,
      biome,
      biomeSite,
      walls: biomeWalls,
      distanceToBiomeBoundary,
      distanceToRiver,
    };
  };

  const getGrid = ({ seed, currentVertex, cellArray, gridSize, gridFunction }: VoronoiGetGridParams): VoronoiGrid[] => {
    const x = Math.floor(currentVertex.x / gridSize);
    const z = Math.floor(currentVertex.z / gridSize);

    if (!gridCachesBySeed[seed]) gridCachesBySeed[seed] = {};
    const cache = gridCachesBySeed[seed];

    const gridKey = `${x},${z}`;
    let grid: VoronoiGrid[] = cache[gridKey];
    if (!grid) {
      grid = [];
      for (let ix = x - 2; ix <= x + 2; ix++) {
        for (let iz = z - 2; iz <= z + 2; iz++) {
          const jitterX = _math.seedRand(`${seed} - ${ix}X${iz}`);
          const jitterZ = _math.seedRand(`${seed} - ${ix}Z${iz}`);
          const point: PointXZ = { x: (ix + jitterX) * gridSize, z: (iz + jitterZ) * gridSize };
          const element = gridFunction(point, cellArray);
          grid.push({ point, element });
        }
      }
      cache[gridKey] = grid;

      for (const key in cache) {
        const [cachedX, cachedZ] = key.split(",").map(Number);
        if (Math.abs(x - cachedX) > 5 || Math.abs(z - cachedZ) > 5) {
          delete cache[key];
        }
      }
    }

    return grid;
  };

  const getNearestEntry = (point: PointXZ, grid: VoronoiGrid[]): VoronoiGrid => {
    let minDist = Infinity, nearest = grid[0];
    for (const entry of grid) {
      const d = (point.x - entry.point.x) ** 2 + (point.z - entry.point.z) ** 2;
      if (d < minDist) { minDist = d; nearest = entry; }
    }
    return nearest;
  };

  const getCurrentBiome = (point: PointXZ, grid: VoronoiGrid[]): Biome => {
    return getNearestEntry(point, grid).element;
  };

  const getCurrentBiomeSite = (point: PointXZ, grid: VoronoiGrid[]): PointXZ => {
    return getNearestEntry(point, grid).point;
  };

  const getCurrentRegion = (point: PointXZ, regionGrid: VoronoiGrid[]): Region => {
    return getNearestEntry(point, regionGrid).element;
  };

  const getCurrentRegionSite = (point: PointXZ, regionGrid: VoronoiGrid[]): PointXZ => {
    return getNearestEntry(point, regionGrid).point;
  };

  const delaunayCache = new WeakMap<VoronoiGrid[], { delaunay: Delaunator<ArrayLike<number>>; circumcenters: number[] }>();

  const getDelaunayData = (grid: VoronoiGrid[]) => {
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
      const ax = grid[ai].point.x, az = grid[ai].point.z;
      const bx = grid[bi].point.x, bz = grid[bi].point.z;
      const cx = grid[ci].point.x, cz = grid[ci].point.z;

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

  const getTwoNearest = (px: number, pz: number, grid: VoronoiGrid[]) => {
    let min1 = Infinity, min2 = Infinity;
    let idx1 = 0, idx2 = 1;
    for (let i = 0; i < grid.length; i++) {
      const d = (px - grid[i].point.x) ** 2 + (pz - grid[i].point.z) ** 2;
      if (d < min1) { min2 = min1; idx2 = idx1; min1 = d; idx1 = i; }
      else if (d < min2) { min2 = d; idx2 = i; }
    }
    return [grid[idx1], grid[idx2]];
  };

  const getWalls = ({
    seed,
    currentVertex,
    grid,
    regionGrid,
    gridSize,
  }: VoronoiGetWallsParams): { biomeWalls: VoronoiWall[]; riverWalls: VoronoiWall[] } => {
    const x = Math.floor(currentVertex.x / gridSize);
    const z = Math.floor(currentVertex.z / gridSize);

    if (!gridCachesBySeed[seed]) gridCachesBySeed[seed] = {};
    const cache = gridCachesBySeed[seed];

    const { delaunay, circumcenters } = getDelaunayData(grid);

    const biomeWalls: VoronoiWall[] = [];
    const riverWalls: VoronoiWall[] = [];

    for (let i = 0; i < delaunay.halfedges.length; i++) {
      const edge = delaunay.halfedges[i];

      if (edge !== -1) {
        const t1 = Math.floor(i / 3);
        const t2 = Math.floor(edge / 3);
        const v1x = circumcenters[t1 * 2], v1z = circumcenters[t1 * 2 + 1];
        const v2x = circumcenters[t2 * 2], v2z = circumcenters[t2 * 2 + 1];

        const midX = (v1x + v2x) / 2;
        const midZ = (v1z + v2z) / 2;
        const label = `${Math.floor(midX)},${Math.floor(midZ)}`;

        if (cache[label] === undefined) {
          const [nearest1, nearest2] = getTwoNearest(midX, midZ, grid);

          const region1 = getNearestEntry(nearest1.point, regionGrid)?.element;
          const region2 = getNearestEntry(nearest2.point, regionGrid)?.element;

          const isRegionBoundary = region1 !== region2;
          const isBiomeBoundary =
            !nearest1.element.joinable || nearest1.element !== nearest2.element;

          cache[label] = {
            grid: [x, z],
            isRegionBoundary,
            isBiomeBoundary,
          };

          for (const key in cache) {
            const cachedData = cache[key];
            if (cachedData.grid) {
              const [cachedX, cachedZ] = cachedData.grid;
              if (Math.abs(x - cachedX) > 5 || Math.abs(z - cachedZ) > 5) {
                delete cache[key];
              }
            }
          }
        }

        const wall: VoronoiWall = { sx: v1x, sz: v1z, ex: v2x, ez: v2z };

        if (cache[label].isRegionBoundary) {
          riverWalls.push(wall);
          biomeWalls.push(wall);
        } else if (cache[label].isBiomeBoundary) {
          biomeWalls.push(wall);
        }
      }
    }

    return { biomeWalls, riverWalls };
  };

  const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    const px = currentVertex.x, pz = currentVertex.z;
    let minDistSq = Infinity;

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const ax = wall.sx, az = wall.sz;
      const bx = wall.ex, bz = wall.ez;

      const dx = bx - ax, dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;

      const cx = ax + t * dx, cz = az + t * dz;
      const ddx = px - cx, ddz = pz - cz;
      const distSq = ddx * ddx + ddz * ddz;
      if (distSq < minDistSq) minDistSq = distSq;
    }

    return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
  };

  if (type === VORONOI_FUNCTION.CREATE) {
    const voronoiData = classifyPoint(params as VoronoiCreateParams);
    self.postMessage(voronoiData);
  }

  if (type === VORONOI_FUNCTION.GET_DISTANCE_TO_WALL) {
    const distance = getDistanceToWall(params as VoronoiGetDistanceToWallParams);
    self.postMessage(distance);
  }
}
