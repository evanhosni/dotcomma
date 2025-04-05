import * as THREE from "three";
import { Apartment } from "../dimensions/glitch-city/biomes/city/blocks/apartment/Apartment";
import { Beeple } from "../dimensions/glitch-city/biomes/city/creatures/beeple/Beeple";
import { BigBeeple } from "../dimensions/glitch-city/biomes/city/creatures/big-beeple/BigBeeple";
import { _math } from "../utils/math/_math";
import { Dimension, Spawner } from "../world/types";
import { OBJECT_RENDER_DISTANCE } from "./ObjectPool";

const GRID_SIZE = 100;

const isLarge = (num: number) => {
  const arr = [
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ];
  return arr[Math.floor(num * arr.length)];
};

const isMed = (num: number) => {
  const arr = [true, false, false, false, false, false, false, false, false, false, false, false, false];
  return arr[Math.floor(num * arr.length)];
};

const grid: any = {}; //TODO typing and clearing

export const getSpawnPoints = async (dimension: Dimension, xxx: number, yyy: number): Promise<Spawner[]> => {
  const OFFSET_GRID = 0.5 * GRID_SIZE;
  const BUFFER = 2 * GRID_SIZE;

  const minX = Math.floor((xxx - OBJECT_RENDER_DISTANCE) / GRID_SIZE) * GRID_SIZE - OFFSET_GRID - BUFFER;
  const maxX = Math.ceil((xxx + OBJECT_RENDER_DISTANCE) / GRID_SIZE) * GRID_SIZE + OFFSET_GRID + BUFFER;
  const minY = Math.floor((yyy - OBJECT_RENDER_DISTANCE) / GRID_SIZE) * GRID_SIZE - OFFSET_GRID - BUFFER;
  const maxY = Math.ceil((yyy + OBJECT_RENDER_DISTANCE) / GRID_SIZE) * GRID_SIZE + OFFSET_GRID + BUFFER;

  const extendedMinX = minX - BUFFER;
  const extendedMaxX = maxX + BUFFER;
  const extendedMinY = minY - BUFFER;
  const extendedMaxY = maxY + BUFFER;

  for (let x = extendedMinX; x <= extendedMaxX; x += 0.5 * GRID_SIZE) {
    for (let y = extendedMinY; y <= extendedMaxY; y += 0.5 * GRID_SIZE) {
      const id = `${x}_${y}`;
      // if (!!grid[id]) continue; //TODO something like this for optimization

      const vertexData = await dimension.getVertexData(x, y);

      const main_grid = (x - extendedMinX) % GRID_SIZE === 0 && (y - extendedMinY) % GRID_SIZE === 0;
      const offset_grid = (x - extendedMinX) % GRID_SIZE !== 0 && (y - extendedMinY) % GRID_SIZE !== 0;

      const include = //TODO test 1.5, i think its right for med stuff
        x >= minX + 1.5 * GRID_SIZE &&
        x <= maxX - 1.5 * GRID_SIZE &&
        y >= minY + 1.5 * GRID_SIZE &&
        y <= maxY - 1.5 * GRID_SIZE;
      const seed = _math.seedRand(id);

      if (main_grid || offset_grid) {
        grid[id] = {
          id,
          x,
          y,
          vertexData,
          include,
          main_grid,
          offset_grid,
          isLarge: main_grid ? isLarge(seed) : false,
          isMed: offset_grid ? isMed(seed) : false,
        };
      }
    }
  }

  const grid_array = Object.values(grid).filter(({ include }: any) => include);
  const spawners: Spawner[] = [];

  // Phase 1: Process large spawners
  grid_array.forEach((point: any) => {
    if (!point.main_grid) return;

    const minX = point.x - GRID_SIZE;
    const maxX = point.x + GRID_SIZE;
    const minY = point.y - GRID_SIZE;
    const maxY = point.y + GRID_SIZE;

    let largeNeighborExists = false;

    outer: for (let x = minX; x <= maxX; x += GRID_SIZE) {
      for (let y = minY; y <= maxY; y += GRID_SIZE) {
        if (x === point.x && y === point.y) continue;

        const id = `${x}_${y}`;
        const neighbor = grid[id];
        if (!neighbor) continue;

        largeNeighborExists = neighbor.isLarge;
        if (largeNeighborExists) break outer;
      }
    }

    if (!largeNeighborExists && point.isLarge) {
      const id = `${point.x}_${point.y}`;
      grid[id].isActuallyLarge = true;

      spawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: BigBeeple,
      });
    }
  });

  // Phase 2: Process medium spawners
  grid_array.forEach((point: any) => {
    if (!point.offset_grid) return;

    const minX = point.x - 1.5 * GRID_SIZE;
    const maxX = point.x + 1.5 * GRID_SIZE;
    const minY = point.y - 1.5 * GRID_SIZE;
    const maxY = point.y + 1.5 * GRID_SIZE;

    let largeNeighborExists = false;
    let medNeighborExists = false;

    outer: for (let x = minX; x <= maxX; x += 0.5 * GRID_SIZE) {
      for (let y = minY; y <= maxY; y += 0.5 * GRID_SIZE) {
        if (x === point.x && y === point.y) continue;

        const main_grid = (x - extendedMinX) % GRID_SIZE === 0 && (y - extendedMinY) % GRID_SIZE === 0;
        const offset_grid = (x - extendedMinX) % GRID_SIZE !== 0 && (y - extendedMinY) % GRID_SIZE !== 0;

        if (!main_grid && !offset_grid) continue;

        const id = `${x}_${y}`;
        const neighbor = grid[id];
        if (!neighbor) continue;

        if (neighbor.main_grid) {
          largeNeighborExists = neighbor.isActuallyLarge;
        }

        if (neighbor.offset_grid) {
          medNeighborExists = neighbor.isActuallyMed;
        }

        if (largeNeighborExists || medNeighborExists) break outer;
      }
    }

    if (!largeNeighborExists && !medNeighborExists && point.isMed) {
      const id = `${point.x}_${point.y}`;
      grid[id].isActuallyMed = true;

      spawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: Apartment,
      });
    }
  });

  // Phase 3: Process small spawners
  grid_array.forEach((point: any) => {
    if (!point.main_grid) return;
    if (point.isActuallyLarge) return; // Skip if this is a large spawner

    // First check for large neighbors (same as in the large spawner phase)
    const largeCheckMinX = point.x - GRID_SIZE;
    const largeCheckMaxX = point.x + GRID_SIZE;
    const largeCheckMinY = point.y - GRID_SIZE;
    const largeCheckMaxY = point.y + GRID_SIZE;

    let largeNeighborExists = false;

    outer: for (let x = largeCheckMinX; x <= largeCheckMaxX; x += GRID_SIZE) {
      for (let y = largeCheckMinY; y <= largeCheckMaxY; y += GRID_SIZE) {
        if (x === point.x && y === point.y) continue;

        const id = `${x}_${y}`;
        const neighbor = grid[id];
        if (!neighbor) continue;

        largeNeighborExists = neighbor.isActuallyLarge;
        if (largeNeighborExists) break outer;
      }
    }

    if (largeNeighborExists) return; // Skip if there's a large neighbor

    // Then check for medium neighbors
    const offsetPositions = [
      { x: point.x + 0.5 * GRID_SIZE, y: point.y + 0.5 * GRID_SIZE },
      { x: point.x + 0.5 * GRID_SIZE, y: point.y - 0.5 * GRID_SIZE },
      { x: point.x - 0.5 * GRID_SIZE, y: point.y + 0.5 * GRID_SIZE },
      { x: point.x - 0.5 * GRID_SIZE, y: point.y - 0.5 * GRID_SIZE },
    ];

    let medNeighborExists = false;

    for (const pos of offsetPositions) {
      const id = `${pos.x}_${pos.y}`;
      const neighbor = grid[id];

      if (neighbor && neighbor.isActuallyMed) {
        medNeighborExists = true;
        break;
      }
    }

    if (!medNeighborExists && !largeNeighborExists) {
      spawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: Beeple,
      });
    }
  });

  return spawners;
};
