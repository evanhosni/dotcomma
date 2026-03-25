import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome, Region } from "../../world/types";
import { _math } from "../math/_math";
import { TaskQueue } from "../task-queue/TaskQueue";
import {
  VORONOI_FUNCTION,
  VoronoiCreateParams,
  VoronoiGetDistanceToWallParams,
  VoronoiGetGridParams,
  VoronoiGrid,
} from "./types";

interface MessageData {
  type: VORONOI_FUNCTION;
  params: VoronoiCreateParams | VoronoiCreateParams[] | VoronoiGetDistanceToWallParams;
}

const caches: any = {};
const taskQueue = new TaskQueue();

self.onmessage = function (event: MessageEvent<MessageData>) {
  taskQueue.addTask(() => handleTask(event.data));
};

async function handleTask(task: MessageData) {
  const { type, params } = task;

  const create = (params: VoronoiCreateParams) => {
    const { seed, currentVertex, regionGridSize, regions, gridSize, biomes } = params as VoronoiCreateParams;

    let grid: VoronoiGrid[] = [];
    let regionGrid: VoronoiGrid[] = [];

    if (regionGridSize && regions?.length) {
      regionGrid = getGrid({
        seed: `${seed} - regionGrid`,
        currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
        cellArray: regions,
        gridSize: regionGridSize,
        gridFunction: (point: THREE.Vector2, regions: Region[]): Region => {
          let uuid = _math.seedRand(`${point.x},${point.y}`);
          let region = regions[Math.floor(uuid * regions.length)];
          return region;
        },
      });

      grid = getGrid({
        seed: `${seed} - grid`,
        currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
        cellArray: regionGrid,
        gridSize: gridSize,
        gridFunction: (point: THREE.Vector2, grid: VoronoiGrid[]): Biome => {
          const nearest = getNearestEntry(point, grid);
          const region: Region = nearest.element;
          let uuid = _math.seedRand(`${point.x},${point.y}`);
          let biome = region.biomes[Math.floor(uuid * region.biomes.length)];
          return biome;
        },
      });
    } else if (biomes?.length) {
      grid = getGrid({
        seed: `${seed} - grid`,
        currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
        cellArray: biomes!,
        gridSize: gridSize,
        gridFunction: (point: THREE.Vector2, biomes: Biome[]): Biome => {
          let uuid = _math.seedRand(`${point.x},${point.y}`);
          let biome = biomes[Math.floor(uuid * biomes.length)];
          return biome;
        },
      });
    }

    const region = getCurrentRegion(new THREE.Vector2(currentVertex.x, currentVertex.y), regionGrid);
    const regionSite = getCurrentRegionSite(new THREE.Vector2(currentVertex.x, currentVertex.y), regionGrid);
    const biome = getCurrentBiome(new THREE.Vector2(currentVertex.x, currentVertex.y), grid);
    const biomeSite = getCurrentBiomeSite(new THREE.Vector2(currentVertex.x, currentVertex.y), grid);

    // Get walls with river boundary information
    const { biomeWalls, riverWalls } = getWalls({
      seed: `${seed} - walls`,
      currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
      grid,
      regionGrid,
      gridSize,
    });

    const distanceToBiomeBoundary = getDistanceToWall({
      currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
      walls: biomeWalls,
    });
    const distanceToRiver = getDistanceToWall({
      currentVertex: new THREE.Vector2(currentVertex.x, currentVertex.y),
      walls: riverWalls,
    });

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
    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const gridKey = `${x},${y}`;
    let grid: VoronoiGrid[] = cache[gridKey];
    if (!grid) {
      grid = [];
      for (let ix = x - 2; ix <= x + 2; ix++) {
        for (let iy = y - 2; iy <= y + 2; iy++) {
          const pointX = _math.seedRand(`${seed} - ${ix}X${iy}`);
          const pointY = _math.seedRand(`${seed} - ${ix}Y${iy}`);
          const point = new THREE.Vector2((ix + pointX) * gridSize, (iy + pointY) * gridSize);
          const element = gridFunction(point, cellArray);
          grid.push({ point, element });
        }
      }
      cache[gridKey] = grid;

      for (const key in cache) {
        const [cachedX, cachedY] = key.split(",").map(Number);
        if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
          delete cache[key];
        }
      }
    }

    return grid;
  };

  const getNearestEntry = (point: THREE.Vector2, grid: VoronoiGrid[]): VoronoiGrid => {
    let minDist = Infinity, nearest = grid[0];
    for (const entry of grid) {
      const d = (point.x - entry.point.x) ** 2 + (point.y - entry.point.y) ** 2;
      if (d < minDist) { minDist = d; nearest = entry; }
    }
    return nearest;
  };

  const getCurrentBiome = (point: THREE.Vector2, grid: VoronoiGrid[]): Biome => {
    return getNearestEntry(point, grid).element;
  };

  const getCurrentBiomeSite = (point: THREE.Vector2, grid: VoronoiGrid[]): THREE.Vector2 => {
    return getNearestEntry(point, grid).point;
  };

  const getCurrentRegion = (point: THREE.Vector2, regionGrid: VoronoiGrid[]): Region => {
    return getNearestEntry(point, regionGrid).element;
  };

  const getCurrentRegionSite = (point: THREE.Vector2, regionGrid: VoronoiGrid[]): THREE.Vector2 => {
    return getNearestEntry(point, regionGrid).point;
  };

  // Cache Delaunay triangulation + circumcenters keyed by grid identity
  const delaunayCache = new WeakMap<VoronoiGrid[], { delaunay: Delaunator<ArrayLike<number>>; circumcenters: number[] }>();

  const getDelaunayData = (grid: VoronoiGrid[]) => {
    let cached = delaunayCache.get(grid);
    if (cached) return cached;

    const coords = new Float64Array(grid.length * 2);
    for (let i = 0; i < grid.length; i++) {
      coords[i * 2] = grid[i].point.x;
      coords[i * 2 + 1] = grid[i].point.y;
    }
    const delaunay = new Delaunator(coords);

    // Pre-compute circumcenters as flat [x, y, x, y, ...] array
    const circumcenters: number[] = [];
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
      const ai = delaunay.triangles[i];
      const bi = delaunay.triangles[i + 1];
      const ci = delaunay.triangles[i + 2];
      const ax = grid[ai].point.x, ay = grid[ai].point.y;
      const bx = grid[bi].point.x, by = grid[bi].point.y;
      const cx = grid[ci].point.x, cy = grid[ci].point.y;

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

  /** Find the two nearest grid entries to a point (by squared distance). */
  const getTwoNearest = (px: number, py: number, grid: VoronoiGrid[]) => {
    let min1 = Infinity, min2 = Infinity;
    let idx1 = 0, idx2 = 1;
    for (let i = 0; i < grid.length; i++) {
      const d = (px - grid[i].point.x) ** 2 + (py - grid[i].point.y) ** 2;
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
  }: {
    seed: string;
    currentVertex: THREE.Vector2;
    grid: VoronoiGrid[];
    regionGrid: VoronoiGrid[];
    gridSize: number;
  }): { biomeWalls: THREE.Line3[]; riverWalls: THREE.Line3[] } => {
    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const { delaunay, circumcenters } = getDelaunayData(grid);

    const biomeWalls: THREE.Line3[] = [];
    const riverWalls: THREE.Line3[] = [];

    for (let i = 0; i < delaunay.halfedges.length; i++) {
      const edge = delaunay.halfedges[i];

      if (edge !== -1) {
        const t1 = Math.floor(i / 3);
        const t2 = Math.floor(edge / 3);
        const v1x = circumcenters[t1 * 2], v1y = circumcenters[t1 * 2 + 1];
        const v2x = circumcenters[t2 * 2], v2y = circumcenters[t2 * 2 + 1];

        const midX = (v1x + v2x) / 2;
        const midY = (v1y + v2y) / 2;
        const label = `${Math.floor(midX)},${Math.floor(midY)}`;

        if (cache[label] === undefined) {
          const [nearest1, nearest2] = getTwoNearest(midX, midY, grid);

          // Find which region each biome belongs to
          const region1 = getNearestEntry(nearest1.point, regionGrid)?.element;
          const region2 = getNearestEntry(nearest2.point, regionGrid)?.element;

          const isRegionBoundary = region1 !== region2;
          const isBiomeBoundary =
            !nearest1.element.joinable || nearest1.element !== nearest2.element;

          cache[label] = {
            grid: currentGrid,
            isRegionBoundary,
            isBiomeBoundary,
          };

          for (const key in cache) {
            const cachedData = cache[key];
            if (cachedData.grid) {
              const [cachedX, cachedY] = cachedData.grid;
              if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
                delete cache[key];
              }
            }
          }
        }

        // Use Vector3 with z=0 for Line3 compatibility (needed by getDistanceToWall)
        const start = new THREE.Vector3(v1x, v1y, 0);
        const end = new THREE.Vector3(v2x, v2y, 0);
        const line = new THREE.Line3(start, end);

        if (cache[label].isRegionBoundary) {
          riverWalls.push(line);
          biomeWalls.push(line);
        } else if (cache[label].isBiomeBoundary) {
          biomeWalls.push(line);
        }
      }
    }

    return { biomeWalls, riverWalls };
  };

  // const getWalls = ({ seed, currentVertex, grid, gridSize }: VoronoiGetWallsParams): THREE.Line3[] => {
  //   const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
  //   const [x, y] = currentGrid;

  //   if (!caches[seed]) caches[seed] = {};
  //   const cache = caches[seed];

  //   const points = grid.map(({ point }) => point);
  //   const delaunay = Delaunator.from(points.map((point) => [point.x, point.y]));

  //   const circumcenters: THREE.Vector3[] = [];
  //   for (let i = 0; i < delaunay.triangles.length; i += 3) {
  //     const a = points[delaunay.triangles[i]];
  //     const b = points[delaunay.triangles[i + 1]];
  //     const c = points[delaunay.triangles[i + 2]];

  //     const ad = a.x * a.x + a.y * a.y;
  //     const bd = b.x * b.x + b.y * b.y;
  //     const cd = c.x * c.x + c.y * c.y;
  //     const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  //     const circumcenter = new THREE.Vector3( //TODO any way to use vector2 instead?
  //       (1 / D) * (ad * (b.y - c.y) + bd * (c.y - a.y) + cd * (a.y - b.y)),
  //       (1 / D) * (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x)),
  //       0
  //     );
  //     circumcenters.push(circumcenter);
  //   }

  //   const voronoiWalls = [];
  //   for (let i = 0; i < delaunay.halfedges.length; i++) {
  //     const edge = delaunay.halfedges[i];

  //     if (edge !== -1) {
  //       const v1 = circumcenters[Math.floor(i / 3)];
  //       const v2 = circumcenters[Math.floor(edge / 3)];

  //       const mid = new THREE.Vector2((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);
  //       const label = `${Math.floor(mid.x)},${Math.floor(mid.y)}`;

  //       if (cache[label] === undefined) {
  //         var midClosestPoints = grid.sort((a, b) => a.point.distanceTo(mid) - b.point.distanceTo(mid));
  //         cache[label] = {
  //           grid: currentGrid,
  //           joinable:
  //             midClosestPoints[0].element.joinable && midClosestPoints[0].element === midClosestPoints[1].element,
  //         };

  //         for (const key in cache) {
  //           const [cachedX, cachedY] = cache[key].grid;
  //           if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
  //             delete cache[key];
  //           }
  //         }
  //       }

  //       if (!cache[label].joinable) {
  //         voronoiWalls.push(new THREE.Line3(v1, v2));
  //       }
  //     }
  //   }
  //   return voronoiWalls;
  // };

  const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    const px = currentVertex.x, py = currentVertex.y;
    let minDistSq = Infinity;

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const ax = wall.start.x, ay = wall.start.y;
      const bx = wall.end.x, by = wall.end.y;

      // Inline closest-point-on-segment distance (2D, z is always 0)
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;

      const cx = ax + t * dx, cy = ay + t * dy;
      const ddx = px - cx, ddy = py - cy;
      const distSq = ddx * ddx + ddy * ddy;
      if (distSq < minDistSq) minDistSq = distSq;
    }

    return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
  };

  if (type === VORONOI_FUNCTION.CREATE) {
    const voronoiData = create(params as VoronoiCreateParams);
    self.postMessage(voronoiData);
  }

  if (type === VORONOI_FUNCTION.CREATE_BULK) {
    const results = (params as VoronoiCreateParams[]).map((param) => create(param));
    self.postMessage({ type: VORONOI_FUNCTION.CREATE_BULK, results });
  }

  if (type === VORONOI_FUNCTION.GET_DISTANCE_TO_WALL) {
    const distance = getDistanceToWall(params as VoronoiGetDistanceToWallParams);
    self.postMessage(distance);
  }
}
