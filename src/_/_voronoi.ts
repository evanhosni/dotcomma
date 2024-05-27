import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome } from "../types/Biome";
import { Region } from "../types/Region";
import { _math } from "./_math";

export interface VoronoiGrid {
  point: THREE.Vector2;
  element: any;
}

interface VoronoiGetGridParams {
  seed: string;
  currentVertex: THREE.Vector2;
  cellArray: any[];
  gridSize: number;
  gridFunction: (point: THREE.Vector2, array: any[]) => any;
}

interface VoronoiGetWallsParams {
  seed: string;
  currentVertex: THREE.Vector2;
  grid: VoronoiGrid[];
  gridSize: number;
}

interface VoronoiGetDistanceToWallParams {
  currentVertex: THREE.Vector2;
  walls: THREE.Line3[];
}

interface VoronoiCreateParamsBase {
  seed: string;
  currentVertex: THREE.Vector2;
  gridSize: number;
}

interface VoronoiCreateParamsWithBiomes extends VoronoiCreateParamsBase {
  biomes: Biome[];
  regionGridSize?: never;
  regions?: never;
}

interface VoronoiCreateParamsWithRegions extends VoronoiCreateParamsBase {
  biomes?: never;
  regionGridSize: number;
  regions: Region[];
}

export type VoronoiCreateParams = VoronoiCreateParamsWithBiomes | VoronoiCreateParamsWithRegions;

const caches: any = {};

export namespace _voronoi {
  export const create = (params: VoronoiCreateParams) => {
    const { seed, currentVertex, regionGridSize, regions, gridSize, biomes } = params;

    let grid: VoronoiGrid[] = [];
    if (regionGridSize && regions?.length) {
      const regionGrid = _voronoi.getGrid({
        seed: `${seed} - regionGrid`,
        currentVertex,
        cellArray: regions,
        gridSize: regionGridSize,
        gridFunction: (point: THREE.Vector2, regions: Region[]): Region => {
          let uuid = _math.seedRand(JSON.stringify(point));
          let region = regions[Math.floor(uuid * regions.length)];
          return region;
        },
      });

      grid = _voronoi.getGrid({
        seed: `${seed} - grid`,
        currentVertex,
        cellArray: regionGrid,
        gridSize: gridSize,
        gridFunction: (point: THREE.Vector2, grid: VoronoiGrid[]): Biome => {
          grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
          const region: Region = grid[0].element;
          let uuid = _math.seedRand(JSON.stringify(point));
          let biome = region.biomes[Math.floor(uuid * region.biomes.length)];
          return biome;
        },
      });
    } else if (biomes?.length) {
      grid = _voronoi.getGrid({
        seed: `${seed} - grid`,
        currentVertex,
        cellArray: biomes!,
        gridSize: gridSize,
        gridFunction: (point: THREE.Vector2, biomes: Biome[]): Biome => {
          let uuid = _math.seedRand(JSON.stringify(point));
          let biome = biomes[Math.floor(uuid * biomes.length)];
          return biome;
        },
      });
    }

    const region = _voronoi.getCurrentRegion(currentVertex, grid);
    const regionSite = _voronoi.getCurrentRegionSite(currentVertex, grid);
    const biome = _voronoi.getCurrentBiome(currentVertex, grid);
    const biomeSite = _voronoi.getCurrentBiomeSite(currentVertex, grid);
    const walls = _voronoi.getWalls({ seed: `${seed} - walls`, currentVertex, grid, gridSize });
    const distance = _voronoi.getDistanceToWall({ currentVertex, walls });

    return { grid, region, regionSite, biome, biomeSite, walls, distance };
  };

  export const getGrid = ({
    seed,
    currentVertex,
    cellArray,
    gridSize,
    gridFunction,
  }: VoronoiGetGridParams): VoronoiGrid[] => {
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
    }

    for (const key in cache) {
      //TODO maybe put this in above if statement to prevent it from happening so often?
      const [cachedX, cachedY] = key.split(",").map(Number);
      if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
        delete cache[key];
      }
    }

    return grid;
  };

  export const getCurrentBiome = (point: THREE.Vector2, grid: VoronoiGrid[]): Biome => {
    grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return grid[0].element;
  };

  export const getCurrentBiomeSite = (point: THREE.Vector2, grid: VoronoiGrid[]): THREE.Vector2 => {
    grid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return grid[0].point;
  };

  export const getCurrentRegion = (point: THREE.Vector2, regionGrid: VoronoiGrid[]): Region => {
    regionGrid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
    return regionGrid[0].element;
  };

  export const getCurrentRegionSite = (point: THREE.Vector2, regionGrid: VoronoiGrid[]): THREE.Vector2 => {
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
      const circumcenter = new THREE.Vector3( //TODO any way to use vector2 instead?
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

        const mid = new THREE.Vector2((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);
        const label = `${Math.floor(mid.x)},${Math.floor(mid.y)}`;

        if (cache[label] === undefined) {
          var midClosestPoints = grid.sort((a, b) => a.point.distanceTo(mid) - b.point.distanceTo(mid));
          cache[label] = {
            grid: currentGrid,
            joinable:
              midClosestPoints[0].element.joinable && midClosestPoints[0].element === midClosestPoints[1].element,
          };

          for (const key in cache) {
            const [cachedX, cachedY] = cache[key].grid;
            if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
              delete cache[key];
            }
          }
        }

        if (!cache[label].joinable) {
          voronoiWalls.push(new THREE.Line3(v1, v2));
        }
      }
    }
    return voronoiWalls;
  };

  export const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    const vec3 = new THREE.Vector3(currentVertex.x, currentVertex.y, 0); //TODO any way to use vector2 instead?

    var closestPoints = [];
    for (let i = 0; i < walls.length; i++) {
      var closestPoint = new THREE.Vector3(0, 0, 0);
      walls[i].closestPointToPoint(vec3, true, closestPoint);
      closestPoints.push(closestPoint);
    }
    closestPoints.sort((a, b) => a.distanceTo(vec3) - b.distanceTo(vec3));

    return closestPoints[0] ? vec3.distanceTo(closestPoints[0]) : 9999; //NOTE closestPoints[0] doesnt exist for some vertices of joinable biomes. This ternary allows us to keep the nested for loop iterations low.
  };
}
