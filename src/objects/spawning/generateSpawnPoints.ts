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
  flattenGround?: boolean;
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
    flattenGround: d.flattenGround,
  }));

// ── Client-side chunk cache ──
// The pool re-requests ALL nearby chunks every spawn batch (~every 5 frames);
// without a client cache the worker re-serializes hundreds of unchanged
// points over postMessage each time. Chunks are cached here after first
// delivery (points are deterministic per chunk and the descriptor set is
// fixed for the session), so steady-state batches touch the worker only for
// NEW chunks. Evicted in cleanupSpawnCache with the same radius rule as the
// worker's cache, so revisited chunks regenerate in both places together.
//
// Entries carry their own world-space CENTER: eviction runs every batch over
// the whole cache, and re-deriving coordinates by parsing the key string
// ("cx_cz".split → Number) made the one operation that keeps the cache
// bounded the most expensive thing about it. Distance is now pure arithmetic
// on fields that are already there.
interface CachedChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
}

const clientChunkCache = new Map<string, CachedChunk>();

const newCachedChunk = (cx: number, cz: number): CachedChunk => ({
  centerX: (cx + 0.5) * SPAWN_CHUNK_SIZE,
  centerZ: (cz + 0.5) * SPAWN_CHUNK_SIZE,
  points: [],
});

const chunkKeyOf = (p: SpawnPoint): string =>
  `${Math.floor(p.x / SPAWN_CHUNK_SIZE)}_${Math.floor(p.z / SPAWN_CHUNK_SIZE)}`;

/**
 * Max NEW chunks generated per round-trip. The whole request is one
 * synchronous burst of work in the worker (every candidate point runs the
 * vertex pipeline), and the pool holds `spawnPending` for its entire
 * duration — which in turn blocks low-LOD terrain building. Asking for every
 * uncached chunk at once turns "the player outran spawning" into a single
 * multi-second worker stall that starves terrain and lands hundreds of mounts
 * in one React commit.
 *
 * Capping it makes catch-up a STREAM instead of a debt: chunk keys arrive
 * sorted nearest-first, so each batch generates the nearest slice, and the
 * next batch re-sorts against the CURRENT camera position — chunks the player
 * has already left behind are never generated at all, they simply stop being
 * requested.
 */
const MAX_NEW_CHUNKS_PER_REQUEST = 12;

/**
 * Spawn points for the given chunk keys, as one bucket per resolved chunk
 * (buckets are the cache's own arrays — do not mutate). Chunk keys must be
 * sorted nearest-first; at most MAX_NEW_CHUNKS_PER_REQUEST uncached chunks
 * are generated per call, the rest are picked up by later calls.
 *
 * All computation happens in the worker thread; delivered chunks are cached
 * client-side so only new chunks cost a round-trip.
 */
export const generateSpawnPoints = async (
  chunkKeys: string[],
  descriptors: SerializedActorDescriptor[]
): Promise<SpawnPoint[][]> => {
  if (!worker || !workerReady) return [];

  const missing: string[] = [];
  for (const k of chunkKeys) {
    if (clientChunkCache.has(k)) continue;
    missing.push(k);
    if (missing.length >= MAX_NEW_CHUNKS_PER_REQUEST) break;
  }

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
    for (const key of missing) {
      const sep = key.indexOf("_");
      clientChunkCache.set(
        key,
        newCachedChunk(Number(key.slice(0, sep)), Number(key.slice(sep + 1)))
      );
    }
    for (const p of points) {
      const entry = clientChunkCache.get(chunkKeyOf(p));
      if (entry) entry.points.push(p);
    }
  }

  const out: SpawnPoint[][] = [];
  for (const key of chunkKeys) {
    const entry = clientChunkCache.get(key);
    if (entry && entry.points.length > 0) out.push(entry.points);
  }
  return out;
};

/**
 * Get chunk keys near a player position, sorted nearest-first (the order
 * generateSpawnPoints relies on to generate the nearest slice each batch).
 * Stays on main thread — pure math, no heavy computation.
 */
const scratchNearby: { key: string; distSq: number }[] = [];

export const getNearbyChunkKeys = (
  playerX: number,
  playerZ: number,
  maxRenderDistance: number
): string[] => {
  const centerCX = Math.floor(playerX / SPAWN_CHUNK_SIZE);
  const centerCZ = Math.floor(playerZ / SPAWN_CHUNK_SIZE);
  const radius = Math.ceil(maxRenderDistance / SPAWN_CHUNK_SIZE) + 1;
  const maxDistSq = (maxRenderDistance + SPAWN_CHUNK_SIZE) ** 2;

  scratchNearby.length = 0;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = centerCX + dx;
      const cz = centerCZ + dz;
      const chunkCenterX = (cx + 0.5) * SPAWN_CHUNK_SIZE;
      const chunkCenterZ = (cz + 0.5) * SPAWN_CHUNK_SIZE;
      const distSq =
        (playerX - chunkCenterX) ** 2 + (playerZ - chunkCenterZ) ** 2;

      if (distSq <= maxDistSq) {
        scratchNearby.push({ key: `${cx}_${cz}`, distSq });
      }
    }
  }

  // Sort on the distance we already computed — the old comparator re-parsed
  // both keys out of their strings on every comparison (O(n log n) splits).
  scratchNearby.sort((a, b) => a.distSq - b.distSq);

  const keys: string[] = new Array(scratchNearby.length);
  for (let i = 0; i < scratchNearby.length; i++) keys[i] = scratchNearby[i].key;
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
  clientChunkCache.forEach((entry, key) => {
    const dx = playerX - entry.centerX;
    const dz = playerZ - entry.centerZ;
    if (dx * dx + dz * dz > cleanupRadiusSq) clientChunkCache.delete(key);
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
