import * as THREE from "three";
import { CHUNK_SIZE } from "../terrain/Terrain";

export interface ScatterCreateParams {
  seed: string;
  currentVertex: THREE.Vector3;
  gridSize: number;
  density: number; //TODO 0 - 1. make type for 0 - 1?
  uniformity: number; //TODO 0 - 1. make type for 0 - 1?
  shift: { x: number; z: number }; //TODO change y to z where applicable
  filter: (point: THREE.Vector3) => any; //TODO typing
}

export namespace _scatter {
  export const create = (params: ScatterCreateParams): { point: THREE.Vector3; element: any }[] => {
    const { seed, currentVertex, gridSize, filter } = params;

    const iterations = Math.ceil(CHUNK_SIZE / 2 / gridSize); //TODO math.ceil aligns em correctly but sometimes leaves spawned objects where there is no terrain. i think this also double spawns certain objects

    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    const grid = [];
    for (let ix = x - iterations; ix <= x + iterations; ix++) {
      for (let iy = y - iterations; iy <= y + iterations; iy++) {
        const pointX = gridSize / 2;
        const pointY = gridSize / 2;
        const point = new THREE.Vector3(ix * gridSize + pointX, 0, iy * gridSize + pointY);
        if (
          point.x >= currentVertex.x - CHUNK_SIZE / 2 &&
          point.x < currentVertex.x + CHUNK_SIZE / 2 &&
          point.z >= currentVertex.y - CHUNK_SIZE / 2 &&
          point.z < currentVertex.y + CHUNK_SIZE / 2
        ) {
          // const element = //TODO grab element from a getSpawners function?
          const element = filter(point);

          if (!!element) {
            //TODO instead of bool make this return component
            grid.push({ point, element });
          }
        }
      }
    }

    return grid;
  };
}

//TODO only calculate spawn points for new grid cells.
