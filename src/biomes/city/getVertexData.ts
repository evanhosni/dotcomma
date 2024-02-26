import * as THREE from "three";
import { biomesInGame } from "../..";
import { _math } from "../../_/math";
import { getBiomeData } from "../../_/terrain/getBiomeData";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { blocks } from "./blocks/[blocks]";

interface Grid {
  point: THREE.Vector3;
  block: any; //TODO add block type
  isEdge: boolean;
  current: boolean;
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

const gridCache: Record<string, Grid[]> = {};
const gridSize = 100;
const roadWidth = 10;

export const getVertexData = (biomeData: VertexData) => {
  const { x, y } = biomeData;
  var vertexData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector3(x, y, 0);

  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)]; //TODO {x,y} rather than [0,1]?
  var grid: Grid[] = [];

  if (gridCache[currentGrid.toString()]) {
    grid = gridCache[currentGrid.toString()];
  } else {
    for (let ix = currentGrid[0] - 2; ix <= currentGrid[0] + 2; ix++) {
      //TODO check if these can be downsized to 1
      for (let iy = currentGrid[1] - 2; iy <= currentGrid[1] + 2; iy++) {
        //TODO check if these can be downsized to 1
        let point = new THREE.Vector3(ix * gridSize + 0.5 * gridSize, iy * gridSize + 0.5 * gridSize, 0);
        let isEdge =
          getBiomeData(point.x, point.y, biomesInGame, true).attributes.distanceToRoadCenter <
          Math.sqrt(gridSize * 0.5 * (gridSize * 0.5) + gridSize * 0.5 * (gridSize * 0.5));
        let block = blocks[Math.floor(_math.seed_rand(JSON.stringify(point)) * blocks.length)];
        let current = ix === currentGrid[0] && iy === currentGrid[1];
        let north = ix === currentGrid[0] && iy === currentGrid[1] + 1;
        let east = ix === currentGrid[0] + 1 && iy === currentGrid[1];
        let south = ix === currentGrid[0] && iy === currentGrid[1] - 1;
        let west = ix === currentGrid[0] - 1 && iy === currentGrid[1];

        grid.push({ point, block, isEdge, current, north, east, south, west });
      }
    }
    gridCache[currentGrid.toString()] = grid;

    for (const key in gridCache) {
      const cachedGrid = key.split(",").map(Number);
      if (Math.abs(currentGrid[0] - cachedGrid[0]) > 5 || Math.abs(currentGrid[1] - cachedGrid[1]) > 5) {
        delete gridCache[key];
      }
    }
  }

  const current = grid.find(({ current }) => current)!;
  const north = grid.find(({ north }) => north)!;
  const east = grid.find(({ east }) => east)!;
  const south = grid.find(({ south }) => south)!;
  const west = grid.find(({ west }) => west)!;

  vertexData.attributes.isEdgeBlock = current.isEdge;
  vertexData.attributes.isRoad = current.isEdge; //false; //vertexData.attributes.isEdgeBlock; //TODO maybe somethign else for edge detection

  if (
    currentVertex.y > (currentGrid[1] + 1) * gridSize - roadWidth &&
    (!current.block.joinable || current.block !== north.block || north.isEdge)
  )
    vertexData.attributes.isRoad = true;
  if (
    currentVertex.x > (currentGrid[0] + 1) * gridSize - roadWidth &&
    (!current.block.joinable || current.block !== east.block || east.isEdge)
  )
    vertexData.attributes.isRoad = true;
  if (
    currentVertex.y < currentGrid[1] * gridSize + roadWidth &&
    (!current.block.joinable || current.block !== south.block || south.isEdge)
  )
    vertexData.attributes.isRoad = true;
  if (
    currentVertex.x < currentGrid[0] * gridSize + roadWidth &&
    (!current.block.joinable || current.block !== west.block || west.isEdge)
  )
    vertexData.attributes.isRoad = true;

  let distanceToStreet = vertexData.attributes.isRoad ? 0 : 999; //TODO something other than 999, actually detect distance?

  vertexData.attributes.distanceToRoadCenter = Math.min(biomeData.attributes.distanceToRoadCenter, distanceToStreet);

  vertexData.height = getHeight(vertexData);

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (!vertexData.attributes.isRoad) {
    height = 1;
  }

  return height;
};
