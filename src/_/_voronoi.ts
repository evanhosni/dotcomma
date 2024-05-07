import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome, Region } from "../types/Biome";
import { _math } from "./_math";

export interface Grid {
  point: THREE.Vector3;
  biome: any;
}

export interface VoronoiGetGridParams {
  seed: string;
  currentVertex: THREE.Vector3;
  cellArray: any[];
  gridSize: number;
  gridFunction: (point: THREE.Vector3, array: any[]) => any;
}

export interface VoronoiGetWallsParams {
  seed: string;
  currentVertex: THREE.Vector3;
  grid: Grid[]; //TODO must be already sorted
  gridSize: number;
}

export interface VoronoiGetDistanceToWallParams {
  currentVertex: THREE.Vector3;
  walls: THREE.Line3[];
}

export interface VoronoiFromRegionsParams {
  seed: string;
  currentVertex: THREE.Vector3;
  gridSize: number;
  regionGridSize: number;
  regions: Region[];
}

export interface VoronoiFromBiomesParams {
  seed: string;
  currentVertex: THREE.Vector3;
  gridSize: number;
  biomes: Biome[];
}

const caches: any = {};

export namespace _voronoi {
  export const fromRegions = (params: VoronoiFromRegionsParams) => {
    const { seed, currentVertex, gridSize, regionGridSize, regions } = params;

    const regionGrid = _voronoi.getGrid({
      seed: `${seed} - fromRegions - regionGrid`,
      currentVertex,
      cellArray: regions,
      gridSize: regionGridSize,
      gridFunction: (point: THREE.Vector3, regions: Region[]): Region => {
        let uuid = _math.seedRand(JSON.stringify(point));
        let biome = regions[Math.floor(uuid * regions.length)];
        return biome;
      },
    });

    const grid = _voronoi.getGrid({
      seed: `${seed} - fromRegions - grid`,
      currentVertex,
      cellArray: regionGrid,
      gridSize,
      gridFunction: (point: THREE.Vector3, grid: Grid[]): Biome => {
        grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
        const region = grid[0].biome;
        let uuid = _math.seedRand(JSON.stringify(point));
        let biome = region.biomes[Math.floor(uuid * region.biomes.length)];
        return biome;
      },
    });

    const region = _voronoi.getCurrentRegion(currentVertex, grid);
    const regionSite = _voronoi.getCurrentRegionSite(currentVertex, grid);
    const biome = _voronoi.getCurrentBiome(currentVertex, grid);
    const biomeSite = _voronoi.getCurrentBiomeSite(currentVertex, grid);
    const walls = _voronoi.getWalls({ seed: `${seed} - fromRegions - walls`, currentVertex, grid, gridSize });
    const distance = _voronoi.getDistanceToWall({ currentVertex, walls });

    return { region, regionSite, biome, biomeSite, walls, distance };
  };

  export const fromBiomes = (params: VoronoiFromBiomesParams) => {
    const { seed, currentVertex, gridSize, biomes } = params;

    const grid = _voronoi.getGrid({
      seed: `${seed} - fromBiomes - grid`,
      currentVertex,
      cellArray: biomes,
      gridSize,
      gridFunction: (point: THREE.Vector3, biomes: Biome[]): Biome => {
        let uuid = _math.seedRand(JSON.stringify(point));
        let biome = biomes[Math.floor(uuid * biomes.length)];
        return biome;
      },
    });

    const region = _voronoi.getCurrentRegion(currentVertex, grid);
    const regionSite = _voronoi.getCurrentRegionSite(currentVertex, grid);
    const biome = _voronoi.getCurrentBiome(currentVertex, grid);
    const biomeSite = _voronoi.getCurrentBiomeSite(currentVertex, grid);
    const walls = _voronoi.getWalls({ seed: `${seed} - fromBiomes - walls`, currentVertex, grid, gridSize });
    const distance = _voronoi.getDistanceToWall({ currentVertex, walls });

    return { region, regionSite, biome, biomeSite, walls, distance };
  };

  export const getGrid = ({ seed, currentVertex, cellArray, gridSize, gridFunction }: VoronoiGetGridParams): Grid[] => {
    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const gridKey = `${x},${y}`;
    let grid = cache[gridKey];
    if (!grid) {
      grid = [];
      for (let ix = x - 2; ix <= x + 2; ix++) {
        for (let iy = y - 2; iy <= y + 2; iy++) {
          const pointX = _math.seedRand(`${seed}${ix}X${iy}`);
          const pointY = _math.seedRand(`${seed}${ix}Y${iy}`);
          const point = new THREE.Vector3((ix + pointX) * gridSize, (iy + pointY) * gridSize, 0);
          const biome = gridFunction(point, cellArray);
          grid.push({ point, biome });
        }
      }
      cache[gridKey] = grid;
    }

    for (const key in cache) {
      const [cachedX, cachedY] = key.split(",").map(Number);
      if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
        delete cache[key];
        // console.log("cache - ", Object.keys(caches).length, caches);
        // console.log("123 - fromRegions - grid", Object.keys(caches.bob).length, caches.bob);
        // console.log("123 - fromRegions - regionGrid", Object.keys(caches.steve).length, caches.steve);
        // console.log("123 - fromRegions - walls", Object.keys(caches.walls).length, caches.walls);
      }
    }

    return grid;
  };

  export const getCurrentBiome = (point: THREE.Vector3, grid: Grid[]): Biome => {
    grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return grid[0].biome;
  };

  export const getCurrentBiomeSite = (point: THREE.Vector3, grid: Grid[]): THREE.Vector3 => {
    grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return grid[0].point;
  };

  export const getCurrentRegion = (point: THREE.Vector3, regionGrid: Grid[]): Region => {
    regionGrid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return regionGrid[0].biome;
  };

  export const getCurrentRegionSite = (point: THREE.Vector3, regionGrid: Grid[]): THREE.Vector3 => {
    regionGrid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return regionGrid[0].point;
  };

  export const getWalls = ({ seed, currentVertex, grid, gridSize }: VoronoiGetWallsParams): THREE.Line3[] => {
    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const points = grid.map(({ point }) => point);
    const delaunay = Delaunator.from(points.map((point) => [point.x, point.y]));

    const circumcenters: THREE.Vector3[] = [];
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
      const a = points[delaunay.triangles[i]];
      const b = points[delaunay.triangles[i + 1]];
      const c = points[delaunay.triangles[i + 2]];

      const ad = a.x * a.x + a.y * a.y;
      const bd = b.x * b.x + b.y * b.y;
      const cd = c.x * c.x + c.y * c.y;
      const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      const circumcenter = new THREE.Vector3(
        (1 / D) * (ad * (b.y - c.y) + bd * (c.y - a.y) + cd * (a.y - b.y)),
        (1 / D) * (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x)),
        0
      );

      circumcenters.push(circumcenter);
    }

    const voronoiWalls = [];
    for (let i = 0; i < delaunay.halfedges.length; i++) {
      const edge = delaunay.halfedges[i];

      if (edge !== -1) {
        const v1 = circumcenters[Math.floor(i / 3)];
        const v2 = circumcenters[Math.floor(edge / 3)];

        const mid = new THREE.Vector3((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, 0);
        const label = `${Math.floor(mid.x)},${Math.floor(mid.y)}`;

        if (cache[label] === undefined) {
          var midClosestPoints = grid.sort((a, b) => a.point.distanceTo(mid) - b.point.distanceTo(mid));
          cache[label] = {
            grid: currentGrid,
            joinable: midClosestPoints[0].biome.joinable && midClosestPoints[0].biome === midClosestPoints[1].biome,
          };

          for (const key in cache) {
            const [cachedX, cachedY] = cache[key].grid;
            if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
              delete cache[key];
            }
          }
        }

        //TODO somewhere around here, check if other side of wall is a diff (blendable) biome. if so, try one more time for biome blending

        if (!cache[label].joinable) {
          voronoiWalls.push(new THREE.Line3(v1, v2));
        }
      }
    }
    return voronoiWalls;
  };

  export const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    var closestPoints = [];
    for (let i = 0; i < walls.length; i++) {
      var closestPoint = new THREE.Vector3(0, 0, 0);
      walls[i].closestPointToPoint(currentVertex, true, closestPoint);
      closestPoints.push(closestPoint);
    }
    closestPoints.sort((a, b) => a.distanceTo(currentVertex) - b.distanceTo(currentVertex));

    return closestPoints[0] ? currentVertex.distanceTo(closestPoints[0]) : 9999; //TODO temp solution. closestPoints[0] doesnt exist for some vertices of joinable biomes
  };
}
