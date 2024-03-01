import * as THREE from "three";
import { biomesInGame } from "../src";
import { _math } from "../src/_/math";
import { getBiomeData } from "../src/_/terrain/getBiomeData";
import { blocks } from "../src/biomes/city/blocks/[blocks]";
import { VertexData, vertexData_default } from "../src/types/VertexData";

interface Grid {
  point: THREE.Vector3;
  block: any; //TODO add block type
  isEdge: boolean;
  current: boolean;
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
  northeast: boolean;
  southeast: boolean;
  southwest: boolean;
  northwest: boolean;
}

const gridCache: Record<string, Grid[]> = {};
const gridSize = 80;
const streetWidth = 12;

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
        let point = new THREE.Vector3(ix * gridSize + 0.5 * gridSize, iy * gridSize + 0.5 * gridSize, 0);
        let isEdge = getBiomeData(point.x, point.y, biomesInGame, true).attributes.distanceToRoadCenter < gridSize; //TODO needs work. this runs the functionagain. maybe pass in edges array to biomeData so you can recalculate distance here
        //Math.sqrt(gridSize * 0.5 * (gridSize * 0.5) + gridSize * 0.5 * (gridSize * 0.5));
        let block = isEdge ? edge : blocks[Math.floor(_math.seed_rand(JSON.stringify(point)) * blocks.length)];
        let current = ix === currentGrid[0] && iy === currentGrid[1];
        let north = ix === currentGrid[0] && iy === currentGrid[1] + 1;
        let east = ix === currentGrid[0] + 1 && iy === currentGrid[1];
        let south = ix === currentGrid[0] && iy === currentGrid[1] - 1;
        let west = ix === currentGrid[0] - 1 && iy === currentGrid[1];
        let northeast = ix === currentGrid[0] + 1 && iy === currentGrid[1] + 1;
        let southeast = ix === currentGrid[0] + 1 && iy === currentGrid[1] - 1;
        let southwest = ix === currentGrid[0] - 1 && iy === currentGrid[1] - 1;
        let northwest = ix === currentGrid[0] - 1 && iy === currentGrid[1] + 1;

        grid.push({
          point,
          block,
          isEdge,
          current,
          north,
          east,
          south,
          west,
          northeast,
          southeast,
          southwest,
          northwest,
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
  const northeast = grid.find(({ northeast }) => northeast)!;
  const east = grid.find(({ east }) => east)!;
  const southeast = grid.find(({ southeast }) => southeast)!;
  const south = grid.find(({ south }) => south)!;
  const southwest = grid.find(({ southwest }) => southwest)!;
  const west = grid.find(({ west }) => west)!;
  const northwest = grid.find(({ northwest }) => northwest)!;

  vertexData.attributes.isEdgeBlock = current.isEdge;

  let distanceNotJoinable = 999;
  let distanceNorth = 999;
  let distanceEast = 999;
  let distanceSouth = 999;
  let distanceWest = 999;
  let distanceNorthEast = 999;
  let distanceSouthEast = 999;
  let distanceSouthWest = 999;
  let distanceNorthWest = 999;

  //TODO dev note, if distance still 999 then block must be surrounded by like blocks on all sides, aka this space can be a stadium or something huge
  if (!current.block.joinable) {
    distanceNotJoinable = Math.min(
      (currentGrid[1] + 1) * gridSize - streetWidth - currentVertex.y,
      (currentGrid[0] + 1) * gridSize - streetWidth - currentVertex.x,
      currentVertex.y - currentGrid[1] * gridSize + streetWidth,
      currentVertex.x - currentGrid[0] * gridSize + streetWidth
    );
  } else {
    if (current.block !== north.block) distanceNorth = (currentGrid[1] + 1) * gridSize - streetWidth - currentVertex.y;
    if (current.block !== east.block) distanceEast = (currentGrid[0] + 1) * gridSize - streetWidth - currentVertex.x;
    if (current.block !== south.block) distanceSouth = currentVertex.y - currentGrid[1] * gridSize + streetWidth;
    if (current.block !== west.block) distanceWest = currentVertex.x - currentGrid[0] * gridSize + streetWidth;

    //////TODO needs work
    if (
      current.block === north.block &&
      current.block === east.block &&
      current.block !== northeast.block &&
      currentGrid[1] * gridSize - currentVertex.y < 0.5 * streetWidth && //TODO should this be 0 or 0.5 * streetWidth?
      currentGrid[0] * gridSize - currentVertex.x < 0.5 * streetWidth //TODO should this be 0 or 0.5 * streetWidth?
    )
      distanceNorthEast = Math.min(
        (currentGrid[1] + 1) * gridSize - streetWidth - currentVertex.y,
        (currentGrid[0] + 1) * gridSize - streetWidth - currentVertex.x
      );
    if (
      current.block === south.block &&
      current.block === east.block &&
      current.block !== southeast.block &&
      Math.abs(currentVertex.y - currentGrid[1] * gridSize) < 0.5 * streetWidth && //TODO should this be 0 or 0.5 * streetWidth?
      Math.abs(currentGrid[0] * gridSize - currentVertex.x) < 0.5 * streetWidth //TODO should this be 0 or 0.5 * streetWidth?
    )
      distanceSouthEast = Math.min(
        currentVertex.y - currentGrid[1] * gridSize + streetWidth,
        (currentGrid[0] + 1) * gridSize - streetWidth - currentVertex.x
      );
    if (
      current.block === south.block &&
      current.block === west.block &&
      current.block !== southwest.block &&
      currentVertex.y - currentGrid[1] * gridSize < 0.5 * streetWidth && //TODO should this be 0 or 0.5 * streetWidth?
      currentVertex.x - currentGrid[0] * gridSize < 0.5 * streetWidth //TODO should this be 0 or 0.5 * streetWidth?
    )
      distanceSouthWest = Math.min(
        currentVertex.y - currentGrid[1] * gridSize + streetWidth,
        currentVertex.x - currentGrid[0] * gridSize + streetWidth
      );
    if (
      current.block === north.block &&
      current.block === west.block &&
      current.block !== northwest.block &&
      currentGrid[1] * gridSize - currentVertex.y < 0.5 * streetWidth && //TODO should this be 0 or 0.5 * streetWidth?
      currentVertex.x - currentGrid[0] * gridSize < 0.5 * streetWidth //TODO should this be 0 or 0.5 * streetWidth?
    )
      distanceNorthWest = Math.min(
        (currentGrid[1] + 1) * gridSize - streetWidth - currentVertex.y,
        currentVertex.x - currentGrid[0] * gridSize + streetWidth
      );
    /////////////////////////////
  }

  vertexData.attributes.distanceToStreetCenter = Math.min(
    distanceNotJoinable,
    distanceNorth,
    distanceEast,
    distanceSouth,
    distanceWest,
    distanceNorthEast,
    distanceSouthEast,
    distanceSouthWest,
    distanceNorthWest,
    vertexData.attributes.isEdgeBlock ? 0 : 999 //TODO this one is temp i think
  );

  vertexData.attributes.debug = {
    dist: Math.floor(vertexData.attributes.distanceToStreetCenter),
    _x: Math.floor(x),
    _y: Math.floor(y),
    north: (currentGrid[1] + 1) * gridSize,
    east: (currentGrid[0] + 1) * gridSize,
    south: currentGrid[1] * gridSize,
    west: currentGrid[0] * gridSize,
    z: {
      dist: vertexData.attributes.distanceToStreetCenter,
      a: current.point.x,
      aa: current.point.y,
      aaa: current.block.name,
      current,
      north,
      east,
      south,
      west,
      northeast,
      southeast,
      southwest,
      northwest,
    },
  };

  const height = getHeight(vertexData);
  vertexData.attributes.donkey = blocks.includes(current.block) ? height : 0; //TODO obviously name something other than donkey

  // vertexData.attributes.debug = vertexData.attributes.donkey;
  vertexData.height = height;

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToStreetCenter > streetWidth) {
    height = 2;
  }

  return height;
};

//TODO i have both isEdgeBlock and current.isEdge
//TODO why does material have some sidewalk spots near the edge of biome?
