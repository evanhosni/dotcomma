import * as THREE from "three";

export interface ScatterGrid {
  point: THREE.Vector3;
  // element: any;
}

export interface ScatterCreateParams {
  seed: string;
  currentVertex: THREE.Vector3;
  gridSize: number;
  density: number; //TODO 0 - 1. make type for 0 - 1?
  uniformity: number; //TODO 0 - 1. make type for 0 - 1?
  shift: { x: number; z: number }; //TODO change y to z where applicable
}

const caches: any = {};

export namespace _scatter {
  export const create = (params: ScatterCreateParams): ScatterGrid[] => {
    const { seed, currentVertex, gridSize } = params;

    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const gridKey = `${x},${y}`;
    let grid: ScatterGrid[] = cache[gridKey];
    if (!grid) {
      grid = [];
      for (let ix = x - 5; ix <= x + 5; ix++) {
        for (let iy = y - 5; iy <= y + 5; iy++) {
          const pointX = gridSize * 0.5;
          const pointY = gridSize * 0.5;
          const point = new THREE.Vector3(ix * gridSize + pointX, 0, iy * gridSize + pointY);
          // const element = //TODO grab element from a getSpawners function?
          grid.push({ point /*, element*/ });
        }
      }
      cache[gridKey] = grid;
    }

    for (const key in cache) {
      const [cachedX, cachedY] = key.split(",").map(Number);
      if (Math.abs(x - cachedX) > 5 || Math.abs(y - cachedY) > 5) {
        delete cache[key];
      }
    }

    return grid;
  };
}
