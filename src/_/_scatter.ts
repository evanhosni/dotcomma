import * as THREE from "three";

export interface ScatterCreateParams {
  seed: string;
  currentVertex: THREE.Vector3;
  gridSize: number;
  density: number; //TODO 0 - 1. make type for 0 - 1?
  uniformity: number; //TODO 0 - 1. make type for 0 - 1?
  shift: { x: number; z: number }; //TODO change y to z where applicable
  filter: (point: THREE.Vector3) => boolean;
}

const DRAW_DISTANCE = 700;

const caches: any = {};

export namespace _scatter {
  export const create = (params: ScatterCreateParams): THREE.Vector3[] => {
    const { seed, currentVertex, gridSize, filter } = params;

    const iterations = DRAW_DISTANCE / gridSize;

    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    if (!caches[seed]) caches[seed] = {};
    const cache = caches[seed];

    const gridKey = `${x},${y}`;
    let grid: THREE.Vector3[] = cache[gridKey];
    if (!grid) {
      grid = [];
      for (let ix = x - iterations; ix <= x + iterations; ix++) {
        for (let iy = y - iterations; iy <= y + iterations; iy++) {
          const pointX = gridSize * 0.5;
          const pointY = gridSize * 0.5;
          const point = new THREE.Vector3(ix * gridSize + pointX, 0, iy * gridSize + pointY);
          // const element = //TODO grab element from a getSpawners function?
          if (filter(point)) {
            grid.push(point /*, element*/);
          }
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
