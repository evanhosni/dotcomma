/**
 * Spawn point generation — worker client.
 *
 * The actual spawn algorithm now runs in spawn.worker.ts.
 * This module manages the worker lifecycle and provides
 * the same public API surface to ObjectPool.
 */

import { WorldConfig } from "../../workers/vertexCompute";
import { SpawnDescriptor, SpawnPoint } from "./types";

const SPAWN_CHUNK_SIZE = 250;

// ── Worker management ──

let worker: Worker | null = null;
let workerReady = false;
const pendingRequests = new Map<number, (points: SpawnPoint[]) => void>();
let nextRequestId = 0;

const handleMessage = (e: MessageEvent) => {
  if (e.data.type === "SPAWNS_RESULT") {
    const resolve = pendingRequests.get(e.data.id);
    if (resolve) {
      resolve(e.data.points);
      pendingRequests.delete(e.data.id);
    }
  }
};

/**
 * Initialize the spawn worker with a dimension config.
 * Must be called before generateSpawnPoints.
 */
export const initSpawnWorker = (
  config: WorldConfig,
  maxFootprint: number
): Promise<void> => {
  worker = new Worker(
    new URL("../../workers/spawn.worker.ts", import.meta.url),
    { type: "module" }
  );

  return new Promise((resolve) => {
    worker!.onmessage = (e: MessageEvent) => {
      if (e.data.type === "INIT_DONE") {
        workerReady = true;
        worker!.onmessage = handleMessage;
        resolve();
      }
    };
    worker!.postMessage({ type: "INIT", config, maxFootprint });
  });
};

/**
 * Serializable subset of SpawnDescriptor (no React component).
 */
export interface SerializedSpawnDescriptor {
  id: string;
  footprint: number;
  density: number;
  clustering: number;
  renderDistance: number;
  priority?: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  spacingOverrides?: Record<string, number>;
}

/**
 * Strip React component from descriptors for worker serialization.
 */
export const serializeDescriptors = (
  descriptors: SpawnDescriptor[]
): SerializedSpawnDescriptor[] =>
  descriptors.map((d) => ({
    id: d.id,
    footprint: d.footprint,
    density: d.density,
    clustering: d.clustering,
    renderDistance: d.renderDistance,
    priority: d.priority,
    biomeIds: d.biomeIds,
    heightRange: d.heightRange,
    slopeRange: d.slopeRange,
    spacingOverrides: d.spacingOverrides,
  }));

/**
 * Generate spawn points for the given chunk keys.
 * All computation happens in the worker thread.
 */
export const generateSpawnPoints = (
  chunkKeys: string[],
  descriptors: SerializedSpawnDescriptor[]
): Promise<SpawnPoint[]> => {
  if (!worker || !workerReady) return Promise.resolve([]);

  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    worker!.postMessage({
      type: "GENERATE_SPAWNS",
      id,
      chunkKeys,
      descriptors,
    });
  });
};

/**
 * Get chunk keys near a player position, sorted by distance.
 * Stays on main thread — pure math, no heavy computation.
 */
export const getNearbyChunkKeys = (
  playerX: number,
  playerZ: number,
  maxRenderDistance: number
): string[] => {
  const centerCX = Math.floor(playerX / SPAWN_CHUNK_SIZE);
  const centerCZ = Math.floor(playerZ / SPAWN_CHUNK_SIZE);
  const radius = Math.ceil(maxRenderDistance / SPAWN_CHUNK_SIZE) + 1;
  const maxDistSq = (maxRenderDistance + SPAWN_CHUNK_SIZE) ** 2;

  const keys: string[] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = centerCX + dx;
      const cz = centerCZ + dz;
      const chunkCenterX = (cx + 0.5) * SPAWN_CHUNK_SIZE;
      const chunkCenterZ = (cz + 0.5) * SPAWN_CHUNK_SIZE;
      const distSq =
        (playerX - chunkCenterX) ** 2 + (playerZ - chunkCenterZ) ** 2;

      if (distSq <= maxDistSq) {
        keys.push(`${cx}_${cz}`);
      }
    }
  }

  keys.sort((a, b) => {
    const [ax, az] = a.split("_").map(Number);
    const [bx, bz] = b.split("_").map(Number);
    const distA = (ax - centerCX) ** 2 + (az - centerCZ) ** 2;
    const distB = (bx - centerCX) ** 2 + (bz - centerCZ) ** 2;
    return distA - distB;
  });

  return keys;
};

/**
 * Tell the worker to evict cached chunks far from the player.
 */
export const cleanupSpawnCache = (
  playerX: number,
  playerZ: number,
  cleanupRadius: number
): void => {
  if (!worker) return;
  worker.postMessage({ type: "CLEANUP", playerX, playerZ, cleanupRadius });
};

/**
 * Recreate the spatial hash with a new footprint.
 */
export const updateSpawnFootprint = (maxFootprint: number): void => {
  if (!worker) return;
  worker.postMessage({ type: "UPDATE_FOOTPRINT", maxFootprint });
};

export { SPAWN_CHUNK_SIZE };
