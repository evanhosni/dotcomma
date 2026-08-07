/**
 * Spawn point generation — worker client.
 *
 * The actual spawn algorithm now runs in spawn.worker.ts.
 * This module manages the worker lifecycle and provides
 * the same public API surface to ObjectPool.
 */

import { WorldConfig } from "../../workers/vertexCompute";
import { ActorDescriptor, SpawnPoint } from "./types";

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
 * Serializable subset of ActorDescriptor (no React component).
 */
export interface SerializedActorDescriptor {
  id: string;
  footprint: number;
  density: number;
  clustering: number;
  renderDistance: number;
  priority?: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  roadDistanceRange?: [number, number];
  spacingOverrides?: Record<string, number>;
}

/**
 * Strip React component from descriptors for worker serialization.
 */
export const serializeDescriptors = (
  descriptors: ActorDescriptor[]
): SerializedActorDescriptor[] =>
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
    roadDistanceRange: d.roadDistanceRange,
    spacingOverrides: d.spacingOverrides,
  }));

// ── Client-side chunk cache ──
// The pool re-requests ALL nearby chunks every spawn batch (~every 5 frames);
// without a client cache the worker re-serializes hundreds of unchanged
// points over postMessage each time. Chunks are cached here after first
// delivery (points are deterministic per chunk and the descriptor set is
// fixed for the session), so steady-state batches touch the worker only for
// NEW chunks. Evicted in cleanupSpawnCache with the same radius rule as the
// worker's cache, so revisited chunks regenerate in both places together.
const clientChunkCache = new Map<string, SpawnPoint[]>();

const chunkKeyOf = (p: SpawnPoint): string =>
  `${Math.floor(p.x / SPAWN_CHUNK_SIZE)}_${Math.floor(p.z / SPAWN_CHUNK_SIZE)}`;

/**
 * Generate spawn points for the given chunk keys.
 * All computation happens in the worker thread; delivered chunks are cached
 * client-side so only new chunks cost a round-trip.
 */
export const generateSpawnPoints = async (
  chunkKeys: string[],
  descriptors: SerializedActorDescriptor[]
): Promise<SpawnPoint[]> => {
  if (!worker || !workerReady) return [];

  const missing = chunkKeys.filter((k) => !clientChunkCache.has(k));
  if (missing.length > 0) {
    const id = nextRequestId++;
    const points = await new Promise<SpawnPoint[]>((resolve) => {
      pendingRequests.set(id, resolve);
      worker!.postMessage({
        type: "GENERATE_SPAWNS",
        id,
        chunkKeys: missing,
        descriptors,
      });
    });
    for (const key of missing) clientChunkCache.set(key, []);
    for (const p of points) {
      const bucket = clientChunkCache.get(chunkKeyOf(p));
      if (bucket) bucket.push(p);
    }
  }

  const out: SpawnPoint[] = [];
  for (const key of chunkKeys) {
    const bucket = clientChunkCache.get(key);
    if (bucket) out.push(...bucket);
  }
  return out;
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
 * Tell the worker to evict cached chunks far from the player — and mirror the
 * eviction in the client cache (same radius rule), so a revisited chunk asks
 * the worker again and both regenerate together.
 */
export const cleanupSpawnCache = (
  playerX: number,
  playerZ: number,
  cleanupRadius: number
): void => {
  if (!worker) return;
  worker.postMessage({ type: "CLEANUP", playerX, playerZ, cleanupRadius });

  const cleanupRadiusSq = cleanupRadius * cleanupRadius;
  clientChunkCache.forEach((_, key) => {
    const [cx, cz] = key.split("_").map(Number);
    const chunkCenterX = (cx + 0.5) * SPAWN_CHUNK_SIZE;
    const chunkCenterZ = (cz + 0.5) * SPAWN_CHUNK_SIZE;
    const distSq = (playerX - chunkCenterX) ** 2 + (playerZ - chunkCenterZ) ** 2;
    if (distSq > cleanupRadiusSq) clientChunkCache.delete(key);
  });
};

/**
 * Recreate the spatial hash with a new footprint.
 */
export const updateSpawnFootprint = (maxFootprint: number): void => {
  if (!worker) return;
  worker.postMessage({ type: "UPDATE_FOOTPRINT", maxFootprint });
};

export { SPAWN_CHUNK_SIZE };
