import * as THREE from "three";
import { Spawner } from "../../world/types";
import { utils } from "../utils";

export interface ScatterCreateParams {
  seed: string;
  currentVertex: THREE.Vector2;
  gridSize: number;
  density: number; //TODO 0 - 1. make type for 0 - 1?
  uniformity: number; //TODO 0 - 1. make type for 0 - 1?
  shift: { x: number; z: number };
  filter: (point: THREE.Vector3) => any | null; //TODO typing for component
}

export const OBJECT_RENDER_DISTANCE = 1000;

export namespace _scatter {
  export const create = async (params: ScatterCreateParams): Promise<Spawner[]> => {
    const { seed, currentVertex, gridSize, filter } = params;
    const render_distance = OBJECT_RENDER_DISTANCE - gridSize;

    const iterations = Math.ceil(render_distance / gridSize);

    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    const grid = [];
    for (let ix = x - iterations; ix <= x + iterations; ix++) {
      for (let iy = y - iterations; iy <= y + iterations; iy++) {
        const pointX = gridSize / 2;
        const pointY = gridSize / 2;
        const point = new THREE.Vector3(ix * gridSize + pointX, 0, iy * gridSize + pointY);
        if (
          // point.x >= currentVertex.x - render_distance &&
          // point.x < currentVertex.x + render_distance &&
          // point.z >= currentVertex.y - render_distance &&
          // point.z < currentVertex.y + render_distance
          utils.getDistance2D(point, new THREE.Vector3(currentVertex.x, 0, currentVertex.y)) < render_distance
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
