/* eslint no-restricted-globals: off */

import { _math } from "./_math";

self.onmessage = function (e) {
  const { seed, currentVertex, cellArray, gridSize, gridFunction } = e.data;

  function getGrid(params: {
    seed: string;
    currentVertex: { x: number; y: number };
    cellArray: any[];
    gridSize: number;
    gridFunction: (point: { x: number; y: number }, cellArray: any[]) => any;
  }) {
    const { seed, currentVertex, cellArray, gridSize, gridFunction } = params;
    const currentGrid = [Math.floor(currentVertex.x / gridSize), Math.floor(currentVertex.y / gridSize)];
    const [x, y] = currentGrid;

    const grid: any[] = [];
    for (let ix = x - 2; ix <= x + 2; ix++) {
      for (let iy = y - 2; iy <= y + 2; iy++) {
        const pointX = _math.seedRand(`${seed} - ${ix}X${iy}`);
        const pointY = _math.seedRand(`${seed} - ${ix}Y${iy}`);
        const point = { x: (ix + pointX) * gridSize, y: (iy + pointY) * gridSize };
        const element = gridFunction(point, cellArray);
        grid.push({ point, element });
      }
    }
    return grid;
  }

  const grid = getGrid({ seed, currentVertex, cellArray, gridSize, gridFunction });

  self.postMessage(grid);
};
