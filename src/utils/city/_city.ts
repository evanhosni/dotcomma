import * as THREE from "three";
import { Block, block_default, VertexData } from "../../world/types";
import { _math } from "../math/_math";
import { voronoi } from "../voronoi/voronoi";

interface CityGrid {
  point: THREE.Vector2;
  block: Block;
  isEdge: boolean;
  current: boolean;
  neighbors: { [key: string]: boolean };
}

interface CityGetGridParams {
  seed: string;
  vertexData: VertexData;
  gridSize: number;
  blocks: Block[];
}

export interface CityCreateParams {
  seed: string;
  vertexData: VertexData;
  gridSize: number;
  blocks: Block[];
}

const caches: any = {};

export namespace _city {
  export const create = async (params: CityCreateParams) => {
    const { seed, vertexData, gridSize, blocks } = params;

    const grid = await _city.getGrid({ seed, vertexData, gridSize, blocks });
    const current = _city.getCurrent(grid);
    const distances = _city.getDistances(vertexData, gridSize);
    const includedBlocks = _city.getIncludedBlocks(current, grid);
    const distanceToRoadCenter = _city.getDistanceToRoadCenter(current, includedBlocks, distances);

    return { grid, current, distances, includedBlocks, distanceToRoadCenter };
  };

  export const getGrid = async ({ seed, vertexData, gridSize, blocks }: CityGetGridParams) => {
    const currentGrid = [Math.floor(vertexData.x / gridSize), Math.floor(vertexData.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const gridKey = `${x},${y}`;
    let grid: CityGrid[] = cache[gridKey];

    if (!grid) {
      grid = [];
      for (let ix = x - 2; ix <= x + 2; ix++) {
        for (let iy = y - 2; iy <= y + 2; iy++) {
          const point = new THREE.Vector2(ix * gridSize + 0.5 * gridSize, iy * gridSize + 0.5 * gridSize);
          const isEdge =
            voronoi.getDistanceToWall({
              currentVertex: new THREE.Vector2(point.x, point.y),
              walls: vertexData.attributes.walls,
            }) < Math.sqrt(gridSize * 0.5 * gridSize * 0.5 + gridSize * 0.5 * gridSize * 0.5);
          const block = isEdge
            ? block_default
            : blocks[Math.floor(_math.seedRand(JSON.stringify(point)) * blocks.length)];

          const neighbors = {
            north: ix === x && iy === y + 1,
            east: ix === x + 1 && iy === y,
            south: ix === x && iy === y - 1,
            west: ix === x - 1 && iy === y,
            northEast: ix === x + 1 && iy === y + 1,
            southEast: ix === x + 1 && iy === y - 1,
            southWest: ix === x - 1 && iy === y - 1,
            northWest: ix === x - 1 && iy === y + 1,
          };

          const current = ix === x && iy === y;

          grid.push({
            point,
            block,
            isEdge,
            current,
            neighbors,
          });
        }
      }
      cache[gridKey] = grid;
    }

    for (const key in cache) {
      //TODO maybe put this in above if statement to prevent it from happening so often?
      const [cachedX, cachedY] = key.split(",").map(Number);
      if (Math.abs(x - cachedX) > 2 || Math.abs(y - cachedY) > 2) {
        //TODO is 5 instead of 2 for voronoi
        delete cache[key];
      }
    }

    return grid;
  };

  export const getCurrent = (grid: CityGrid[]) => {
    return grid.find(({ current }) => current)!;
  };

  export const getDistances = (vertexData: VertexData, gridSize: number) => {
    const currentGrid = [Math.floor(vertexData.x / gridSize), Math.floor(vertexData.y / gridSize)];
    const [x, y] = currentGrid;

    const distanceToNorthWall = (y + 1) * gridSize - vertexData.y;
    const distanceToEastWall = (x + 1) * gridSize - vertexData.x;
    const distanceToSouthWall = vertexData.y - y * gridSize;
    const distanceToWestWall = vertexData.x - x * gridSize;

    //TODO used to be this (incorporates road width, which was a param)
    // const distanceToNorthWall = (y + 1) * gridSize - 0.5 * roadWidth - vertexData.y;
    // const distanceToEastWall = (x + 1) * gridSize - 0.5 * roadWidth - vertexData.x;
    // const distanceToSouthWall = vertexData.y - y * gridSize + 0.5 * roadWidth;
    // const distanceToWestWall = vertexData.x - x * gridSize + 0.5 * roadWidth;

    const distances = {
      toNorthWall: distanceToNorthWall,
      toEastWall: distanceToEastWall,
      toSouthWall: distanceToSouthWall,
      toWestWall: distanceToWestWall,
      toNorthEastCorner: Math.max(distanceToNorthWall, distanceToEastWall),
      toSouthEastCorner: Math.max(distanceToSouthWall, distanceToEastWall),
      toSouthWestCorner: Math.max(distanceToSouthWall, distanceToWestWall),
      toNorthWestCorner: Math.max(distanceToNorthWall, distanceToWestWall),
    };

    return distances;
  };

  export const getIncludedBlocks = (current: CityGrid, grid: CityGrid[]) => {
    const includedBlocks = {
      northWall: current.block !== grid.find(({ neighbors }) => neighbors.north)?.block,
      eastWall: current.block !== grid.find(({ neighbors }) => neighbors.east)?.block,
      southWall: current.block !== grid.find(({ neighbors }) => neighbors.south)?.block,
      westWall: current.block !== grid.find(({ neighbors }) => neighbors.west)?.block,
      northEastCorner: current.block !== grid.find(({ neighbors }) => neighbors.northEast)?.block,
      southEastCorner: current.block !== grid.find(({ neighbors }) => neighbors.southEast)?.block,
      southWestCorner: current.block !== grid.find(({ neighbors }) => neighbors.southWest)?.block,
      northWestCorner: current.block !== grid.find(({ neighbors }) => neighbors.northWest)?.block,
    };

    return includedBlocks;
  };

  export const getDistanceToRoadCenter = (
    current: CityGrid,
    includedBlocks: { [key: string]: boolean },
    distances: { [key: string]: number }
  ) => {
    const distanceToRoadCenter = Math.min(
      includedBlocks.northWall ? distances.toNorthWall : 999,
      includedBlocks.eastWall ? distances.toEastWall : 999,
      includedBlocks.southWall ? distances.toSouthWall : 999,
      includedBlocks.westWall ? distances.toWestWall : 999,
      includedBlocks.northEastCorner ? distances.toNorthEastCorner : 999,
      includedBlocks.southEastCorner ? distances.toSouthEastCorner : 999,
      includedBlocks.southWestCorner ? distances.toSouthWestCorner : 999,
      includedBlocks.northWestCorner ? distances.toNorthWestCorner : 999,
      current.isEdge ? 0 : 999 // TODO was vertexData.attributes.isEdgeBlock ? 0 : 999
    );

    return distanceToRoadCenter;
  };
}
