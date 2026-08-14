/**
 * Spawn point generation — worker client.
 *
 * The actual spawn algorithm now runs in spawn.worker.ts.
 * This module manages the worker lifecycle and provides
 * the same public API surface to ObjectPool.
 */

import { DomainConfig } from "../../utils/workers/vertexCompute";
import { ActorDescriptor, SpawnPoint } from "./types";

const SPAWN_CHUNK_SIZE = 250;

// ── Worker management ──

let worker: Worker | null = null;
let workerReady = false;
/** Points for the chunks the worker actually finished, plus their keys — a
 *  time-budgeted request may complete only a prefix of what was asked for. */
interface SpawnsResult {
  points: SpawnPoint[];
  done: string[];
}

const pendingRequests = new Map<number, (result: SpawnsResult) => void>();
let nextRequestId = 0;

const handleMessage = (e: MessageEvent) => {
  if (e.data.type === "SPAWNS_RESULT") {
    const resolve = pendingRequests.get(e.data.id);
    if (resolve) {
      resolve({ points: e.data.points, done: e.data.done });
      pendingRequests.delete(e.data.id);
    }
  }
};

/**
 * Initialize the spawn worker with a dimension config.
 * Must be called before generateSpawnPoints.
 */
export const initSpawnWorker = (
  config: DomainConfig,
  maxFootprint: number
): Promise<void> => {
  worker?.terminate(); // ObjectPool remounts on world switch — never leak the old worker
  worker = new Worker(
    new URL("../../utils/workers/spawn.worker.ts", import.meta.url),
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
// The cache entries themselves are what generateSpawnPoints returns — the
// center coordinates double as the pool's per-bucket early-out (skip a whole
// chunk when even its nearest corner is beyond every spawn radius) without a
// second wrapper allocation. Treat as read-only outside this module.
export interface SpawnChunkBucket {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
}

const clientChunkCache = new Map<string, SpawnChunkBucket>();

/** Domain switch (resetDomainSystems): kill the worker and every cached point —
 *  spawn points are world-config-dependent, and the next ObjectPool mount
 *  re-inits via initSpawnWorker with the new committed config. */
export const resetSpawnWorker = () => {
  worker?.terminate();
  worker = null;
  workerReady = false;
  pendingRequests.clear();
  clientChunkCache.clear();
};

const newCachedChunk = (cx: number, cz: number): SpawnChunkBucket => ({
  centerX: (cx + 0.5) * SPAWN_CHUNK_SIZE,
  centerZ: (cz + 0.5) * SPAWN_CHUNK_SIZE,
  points: [],
});

const chunkKeyOf = (p: SpawnPoint): string =>
  `${Math.floor(p.x / SPAWN_CHUNK_SIZE)}_${Math.floor(p.z / SPAWN_CHUNK_SIZE)}`;

/**
 * How long the worker may spend generating NEW chunks per round-trip.
 *
 * A time budget rather than a chunk count, because per-chunk cost varies by
 * more than 10× with terrain — a dense city chunk runs the flatten engine over
 * thousands of pad candidates (~60ms), an empty grassland chunk is nearly
 * free. Any fixed count is therefore both too long in the city and too short
 * in open terrain, where the worker would idle against the batch cadence
 * floor (MIN_FRAMES_BETWEEN_BATCHES, ~83ms at 60fps — which is why this sits
 * just above it).
 *
 * This is also what makes catch-up a STREAM instead of a debt. Keys go out
 * sorted nearest-first; whatever the budget doesn't reach is left uncached and
 * re-requested next batch, re-sorted against the CURRENT camera position. So
 * ground the player has already left is never generated at all — it just stops
 * being asked for.
 */
const SPAWN_BUDGET_MS = 100;

/**
 * Spawn points for the given chunk keys, as one bucket per resolved chunk,
 * each carrying its chunk CENTER (buckets are the cache's own entries/arrays
 * — do not mutate; point objects are identity-stable across calls while the
 * chunk stays cached, which is what lets the pool's mounted/ledger checks be
 * identity lookups instead of string builds). Chunk keys must be sorted
 * nearest-first: the worker spends SPAWN_BUDGET_MS on uncached chunks in that
 * order, and the remainder is picked up by later calls.
 *
 * All computation happens in the worker thread; delivered chunks are cached
 * client-side so only new chunks cost a round-trip.
 */
export const generateSpawnPoints = async (
  chunkKeys: string[],
  descriptors: SerializedActorDescriptor[]
): Promise<SpawnChunkBucket[]> => {
  if (!worker || !workerReady) return [];

  const missing = chunkKeys.filter((k) => !clientChunkCache.has(k));

  if (missing.length > 0) {
    const id = nextRequestId++;
    const result = await new Promise<SpawnsResult>((resolve) => {
      pendingRequests.set(id, resolve);
      worker!.postMessage({
        type: "GENERATE_SPAWNS",
        id,
        chunkKeys: missing,
        descriptors,
        budgetMs: SPAWN_BUDGET_MS,
      });
    });
    // Only chunks the worker FINISHED get cached — the rest stay unknown and
    // are re-requested (or dropped, if the player has moved on).
    for (const key of result.done) {
      const sep = key.indexOf("_");
      clientChunkCache.set(
        key,
        newCachedChunk(Number(key.slice(0, sep)), Number(key.slice(sep + 1)))
      );
    }
    for (const p of result.points) {
      const entry = clientChunkCache.get(chunkKeyOf(p));
      if (entry) entry.points.push(p);
    }
  }

  const out: SpawnChunkBucket[] = [];
  for (const key of chunkKeys) {
    const entry = clientChunkCache.get(key);
    if (entry && entry.points.length > 0) out.push(entry);
  }
  return out;
};

// getNearbyChunkKeys memo: the set-and-order of nearby chunk keys only
// changes when the player crosses into a different 250u chunk (the distances
// are measured center-chunk-relative), yet the pool calls this every batch
// (~every 5 frames) — ~49 wrapper objects + key strings + a sort each time,
// almost always identical to the last call. One entry is enough: there is one
// caller with one (constant-per-session) radius. Callers treat the result as
// read-only (they filter/iterate, never mutate), so the same array is safe to
// hand back.
let nearbyKeysCX = NaN;
let nearbyKeysCZ = NaN;
let nearbyKeysDist = NaN;
let nearbyKeysCache: string[] = [];

/**
 * Get chunk keys near a player position, sorted nearest-first (the order
 * generateSpawnPoints relies on to generate the nearest slice each batch).
 * Stays on main thread — pure math, no heavy computation. Returns a cached
 * (shared, read-only) array while the player stays in the same chunk.
 */
export const getNearbyChunkKeys = (
  playerX: number,
  playerZ: number,
  maxRenderDistance: number
): string[] => {
  const centerCX = Math.floor(playerX / SPAWN_CHUNK_SIZE);
  const centerCZ = Math.floor(playerZ / SPAWN_CHUNK_SIZE);
  if (
    centerCX === nearbyKeysCX &&
    centerCZ === nearbyKeysCZ &&
    maxRenderDistance === nearbyKeysDist
  ) {
    return nearbyKeysCache;
  }

  const radius = Math.ceil(maxRenderDistance / SPAWN_CHUNK_SIZE) + 1;
  const maxDistSq = (maxRenderDistance + SPAWN_CHUNK_SIZE) ** 2;

  const nearby: { key: string; distSq: number }[] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = centerCX + dx;
      const cz = centerCZ + dz;
      const chunkCenterX = (cx + 0.5) * SPAWN_CHUNK_SIZE;
      const chunkCenterZ = (cz + 0.5) * SPAWN_CHUNK_SIZE;
      const distSq =
        (playerX - chunkCenterX) ** 2 + (playerZ - chunkCenterZ) ** 2;

      if (distSq <= maxDistSq) {
        nearby.push({ key: `${cx}_${cz}`, distSq });
      }
    }
  }

  // Sort on the distance we already computed — the old comparator re-parsed
  // both keys out of their strings on every comparison (O(n log n) splits).
  nearby.sort((a, b) => a.distSq - b.distSq);

  // Distances (and thus the order) are measured from the exact position at
  // fill time, so within a chunk the memoized order is a snapshot — that only
  // quantizes the worker's nearest-first SCHEDULING to chunk granularity
  // (which chunks the time budget reaches first), never which points a chunk
  // contains once generated.
  nearbyKeysCX = centerCX;
  nearbyKeysCZ = centerCZ;
  nearbyKeysDist = maxRenderDistance;
  nearbyKeysCache = nearby.map((n) => n.key);
  return nearbyKeysCache;
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
