import * as THREE from "three";
import { CHUNK_SIZE } from "../../world/terrain/Terrain";
import { Spawner } from "../../world/types";

export interface ScatterCreateParams {
  seed: string;
  currentVertex: THREE.Vector2;
  gridSize: number;
  density: number; //TODO 0 - 1. make type for 0 - 1?
  uniformity: number; //TODO 0 - 1. make type for 0 - 1?
  shift: { x: number; z: number };
  filter: (point: THREE.Vector3) => any | null; //TODO typing for component
}

export namespace _scatter {
  export const create = async (params: ScatterCreateParams): Promise<Spawner[]> => {
    const { seed, currentVertex, gridSize, filter } = params;

    const iterations = Math.ceil(CHUNK_SIZE / 2 / gridSize);

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
          const element = await filter(point);
          if (!!element) {
            grid.push({ point, element });
          }
        }
      }
    }

    return grid;
  };
}
