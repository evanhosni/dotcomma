import * as THREE from "three";
import { _math } from "../../_/_math";
import { _voronoi } from "../../_/_voronoi";
import { VertexData } from "../../types/VertexData";
import { blocks } from "./blocks/[blocks]";

interface Grid {
  point: THREE.Vector3;
  block: any; //TODO add block type
  isEdge: boolean;
  current: boolean;
  neighbors: { [key: string]: boolean };
}

const gridCache: Record<string, Grid[]> = {};
const gridSize = 100; //TODO note with gridSize 100 and ROAD_WIDTH 10, blocks are 80x80 and buildings should be like...50x50
export const ROAD_WIDTH = 10;

const edge = { name: "edge", joinable: true };

const getGridKey = (x: number, y: number) => `${x},${y}`;

export const getVertexData = (vertexData: VertexData) => {
  const { x, y } = vertexData;
  const currentVertex = new THREE.Vector3(x, y, 0);

  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
  const gridKey = getGridKey(currentGrid[0], currentGrid[1]);
  let grid: Grid[] = gridCache[gridKey] || [];

  if (grid.length === 0) {
    for (let ix = currentGrid[0] - 2; ix <= currentGrid[0] + 2; ix++) {
      for (let iy = currentGrid[1] - 2; iy <= currentGrid[1] + 2; iy++) {
        const point = new THREE.Vector3(ix * gridSize + 0.5 * gridSize, iy * gridSize + 0.5 * gridSize, 0);
        const isEdge =
          _voronoi.getDistanceToWall({ currentVertex: point, walls: vertexData.attributes.walls }) <
          Math.sqrt(gridSize * 0.5 * gridSize * 0.5 + gridSize * 0.5 * gridSize * 0.5);
        const block = isEdge ? edge : blocks[Math.floor(_math.seedRand(JSON.stringify(point)) * blocks.length)];

        const neighbors = {
          north: ix === currentGrid[0] && iy === currentGrid[1] + 1,
          east: ix === currentGrid[0] + 1 && iy === currentGrid[1],
          south: ix === currentGrid[0] && iy === currentGrid[1] - 1,
          west: ix === currentGrid[0] - 1 && iy === currentGrid[1],
          northEast: ix === currentGrid[0] + 1 && iy === currentGrid[1] + 1,
          southEast: ix === currentGrid[0] + 1 && iy === currentGrid[1] - 1,
          southWest: ix === currentGrid[0] - 1 && iy === currentGrid[1] - 1,
          northWest: ix === currentGrid[0] - 1 && iy === currentGrid[1] + 1,
        };

        grid.push({
          point,
          block,
          isEdge,
          current: ix === currentGrid[0] && iy === currentGrid[1],
          neighbors,
        });
      }
    }
    gridCache[gridKey] = grid;

    for (const key in gridCache) {
      const [cachedX, cachedY] = key.split(",").map(Number);
      if (Math.abs(currentGrid[0] - cachedX) > 2 || Math.abs(currentGrid[1] - cachedY) > 2) {
        delete gridCache[key];
      }
    }
  }

  const current = grid.find(({ current }) => current)!;

  vertexData.attributes.isEdgeBlock = current.isEdge;
  vertexData.attributes.block = current.block;

  const distanceToNorthWall = (currentGrid[1] + 1) * gridSize - 0.5 * ROAD_WIDTH - currentVertex.y;
  const distanceToEastWall = (currentGrid[0] + 1) * gridSize - 0.5 * ROAD_WIDTH - currentVertex.x;
  const distanceToSouthWall = currentVertex.y - currentGrid[1] * gridSize + 0.5 * ROAD_WIDTH;
  const distanceToWestWall = currentVertex.x - currentGrid[0] * gridSize + 0.5 * ROAD_WIDTH;
  const distanceToNorthEastCorner = Math.max(distanceToNorthWall, distanceToEastWall);
  const distanceToSouthEastCorner = Math.max(distanceToSouthWall, distanceToEastWall);
  const distanceToSouthWestCorner = Math.max(distanceToSouthWall, distanceToWestWall);
  const distanceToNorthWestCorner = Math.max(distanceToNorthWall, distanceToWestWall);

  const include = {
    northWall: current.block !== grid.find(({ neighbors }) => neighbors.north)?.block,
    eastWall: current.block !== grid.find(({ neighbors }) => neighbors.east)?.block,
    southWall: current.block !== grid.find(({ neighbors }) => neighbors.south)?.block,
    westWall: current.block !== grid.find(({ neighbors }) => neighbors.west)?.block,
    northEastCorner: current.block !== grid.find(({ neighbors }) => neighbors.northEast)?.block,
    southEastCorner: current.block !== grid.find(({ neighbors }) => neighbors.southEast)?.block,
    southWestCorner: current.block !== grid.find(({ neighbors }) => neighbors.southWest)?.block,
    northWestCorner: current.block !== grid.find(({ neighbors }) => neighbors.northWest)?.block,
  };

  vertexData.attributes.distanceToRoadCenter = Math.min(
    include.northWall ? distanceToNorthWall : 999,
    include.eastWall ? distanceToEastWall : 999,
    include.southWall ? distanceToSouthWall : 999,
    include.westWall ? distanceToWestWall : 999,
    include.northEastCorner ? distanceToNorthEastCorner : 999,
    include.southEastCorner ? distanceToSouthEastCorner : 999,
    include.southWestCorner ? distanceToSouthWestCorner : 999,
    include.northWestCorner ? distanceToNorthWestCorner : 999,
    vertexData.attributes.isEdgeBlock ? 0 : 999
  );

  vertexData.height = getHeight(vertexData);

  // if (Object.values(include).every((inc) => !inc)) {
  //   console.log("this is where a big arena or something could be", current.point); //TODO add big arena sized blocks
  // }

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRoadCenter > ROAD_WIDTH) {
    height = 0.5;
  }

  return height;
};
