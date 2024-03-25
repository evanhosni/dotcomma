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
  northEast: boolean;
  southEast: boolean;
  southWest: boolean;
  northWest: boolean;
}

const gridCache: Record<string, Grid[]> = {};
const gridSize = 100; //TODO note with gridSize 100 and roadWidth 10, blocks are 80x80 and buildings should be like...50x50
const roadWidth = 10;

const edge = { name: "edge", joinable: true };

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
        const point = new THREE.Vector3(ix * gridSize + 0.5 * gridSize, iy * gridSize + 0.5 * gridSize, 0);
        const isEdge =
          getBiomeData(point.x, point.y, biomesInGame, true).attributes.distanceToRoadCenter <
          Math.sqrt(gridSize * 0.5 * (gridSize * 0.5) + gridSize * 0.5 * (gridSize * 0.5)); //TODO needs work. this runs the functionagain. maybe pass in edges array to biomeData so you can recalculate distance here. also, blocks get pretty close to biome border road. //TODO plus or minus the roadNoise because currently distanceToRoadCenter is factoring straight roads
        const block = isEdge ? edge : blocks[Math.floor(_math.seed_rand(JSON.stringify(point)) * blocks.length)];
        const current = ix === currentGrid[0] && iy === currentGrid[1];
        const north = ix === currentGrid[0] && iy === currentGrid[1] + 1;
        const east = ix === currentGrid[0] + 1 && iy === currentGrid[1];
        const south = ix === currentGrid[0] && iy === currentGrid[1] - 1;
        const west = ix === currentGrid[0] - 1 && iy === currentGrid[1];
        const northEast = ix === currentGrid[0] + 1 && iy === currentGrid[1] + 1;
        const southEast = ix === currentGrid[0] + 1 && iy === currentGrid[1] - 1;
        const southWest = ix === currentGrid[0] - 1 && iy === currentGrid[1] - 1;
        const northWest = ix === currentGrid[0] - 1 && iy === currentGrid[1] + 1;

        grid.push({
          point,
          block,
          isEdge,
          current,
          north,
          east,
          south,
          west,
          northEast,
          southEast,
          southWest,
          northWest,
        });
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
  const northEast = grid.find(({ northEast }) => northEast)!;
  const east = grid.find(({ east }) => east)!;
  const southEast = grid.find(({ southEast }) => southEast)!;
  const south = grid.find(({ south }) => south)!;
  const southWest = grid.find(({ southWest }) => southWest)!;
  const west = grid.find(({ west }) => west)!;
  const northWest = grid.find(({ northWest }) => northWest)!;

  vertexData.attributes.isEdgeBlock = current.isEdge;

  const distanceToNorthWall = (currentGrid[1] + 1) * gridSize - 0.5 * roadWidth - currentVertex.y;
  const distanceToEastWall = (currentGrid[0] + 1) * gridSize - 0.5 * roadWidth - currentVertex.x;
  const distanceToSouthWall = currentVertex.y - currentGrid[1] * gridSize + 0.5 * roadWidth;
  const distanceToWestWall = currentVertex.x - currentGrid[0] * gridSize + 0.5 * roadWidth;
  const distanceToNorthEastCorner = Math.max(distanceToNorthWall, distanceToEastWall);
  const distanceToSouthEastCorner = Math.max(distanceToSouthWall, distanceToEastWall);
  const distanceToSouthWestCorner = Math.max(distanceToSouthWall, distanceToWestWall);
  const distanceToNorthWestCorner = Math.max(distanceToNorthWall, distanceToWestWall);

  const include = {
    northWall: current.block !== north.block,
    eastWall: current.block !== east.block,
    southWall: current.block !== south.block,
    westWall: current.block !== west.block,
    northEastCorner: current.block !== northEast.block,
    southEastCorner: current.block !== southEast.block,
    southWestCorner: current.block !== southWest.block,
    northWestCorner: current.block !== northWest.block,
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

  vertexData.attributes.debug = {
    dist: vertexData.attributes.disterooni,
    // dist: Math.floor(vertexData.attributes.distanceToRoadCenter),
    // _x: Math.floor(x),
    // _y: Math.floor(y),
    // north: (currentGrid[1] + 1) * gridSize,
    // east: (currentGrid[0] + 1) * gridSize,
    // south: currentGrid[1] * gridSize,
    // west: currentGrid[0] * gridSize,
    // z: {
    //   dist: vertexData.attributes.distanceToRoadCenter,
    // x: current.point.x,
    // y: current.point.y,
    // blockname: current.block.name,
    // current,
    // north,
    // east,
    // south,
    // west,
    // northEast,
    // southEast,
    // southWest,
    // northWest,
    // },
  };

  vertexData.height = getHeight(vertexData);

  if (
    current.block === north.block &&
    current.block === east.block &&
    current.block === south.block &&
    current.block === west.block &&
    current.block === northEast.block &&
    current.block === southEast.block &&
    current.block === southWest.block &&
    current.block === northWest.block
  )
    console.log("this is where a big arena or something could be", current.point); //TODO

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRoadCenter > roadWidth) {
    height = 0.5;
  }

  if (vertexData.attributes.distanceToRoadCenter > roadWidth + 10) {
    height = 100.5;
  }

  return height;
};

//TODO i have both isEdgeBlock and current.isEdge
