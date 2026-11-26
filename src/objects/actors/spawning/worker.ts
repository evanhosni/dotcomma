import { DomainConfig } from "../../../generation";
import { createWorkerClient } from "../../../utils/worker-client";
import { getActiveActors } from "../../../world/domains/store";
import { SPAWN_CHUNK_SIZE } from "./constants";
import { AnyActorDescriptor, SerializedActorDescriptor, SpawnPoint } from "./types";

/** A time-budgeted request may finish only a prefix of the requested chunks. */
interface SpawnsResult {
  points: SpawnPoint[];
  done: string[];
}

let pendingInit: { config: DomainConfig; maxFootprint: number } | null = null;
/** Settles once ActorPool has booted the worker for the committed domain; asked before that, the
 *  waiters are told when it boots. */
let ready: Promise<void> | null = null;
let readyWaiters: (() => void)[] = [];

const client = createWorkerClient({
  create: () => new Worker(new URL("./spawn.worker.ts", import.meta.url), { type: "module" }),
  init: () => pendingInit!,
  resultType: "SPAWNS_RESULT",
});

/** Always boots a FRESH worker (ActorPool re-inits on domain switch and footprint change). */
export const initSpawnWorker = (config: DomainConfig, maxFootprint: number): Promise<void> => {
  client.reset();
  pendingInit = { config, maxFootprint };
  ready = client.ensure();
  for (const wake of readyWaiters.splice(0)) wake();
  return ready;
};

export const serializeDescriptors = (
  descriptors: AnyActorDescriptor[]
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
    feature: d.feature,
    zone: d.zone,
  }));

// Client-side chunk cache: the pool re-requests ALL nearby chunks every batch,
// so without it the worker would re-serialize hundreds of unchanged points each
// time. Entries carry their CENTER: parsing it out of the key would make
// eviction the most expensive thing about the cache. Read-only outside this module.
export interface CachedSpawnChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
}

const clientChunkCache = new Map<string, CachedSpawnChunk>();

export const resetSpawnWorker = () => {
  ready = null;
  client.reset();
  clientChunkCache.clear();
};

const emptyCachedChunk = (cx: number, cz: number): CachedSpawnChunk => ({
  centerX: (cx + 0.5) * SPAWN_CHUNK_SIZE,
  centerZ: (cz + 0.5) * SPAWN_CHUNK_SIZE,
  points: [],
});

const chunkKeyOf = (p: SpawnPoint): string =>
  `${Math.floor(p.x / SPAWN_CHUNK_SIZE)}_${Math.floor(p.z / SPAWN_CHUNK_SIZE)}`;

// A TIME budget, not a chunk count: per-chunk cost varies >10× with terrain
// (a city chunk ~60ms of flatten pads, a grass chunk nearly free). Sits just
// above the batch cadence floor (MIN_FRAMES_BETWEEN_BATCHES ≈ 83ms).
const SPAWN_BUDGET_MS = 100;
const MAX_LOAD_ROUNDS = 30;

/** Asks the worker for the chunks not cached yet (keys sorted nearest-first: the budget covers them
 *  in that order and the rest are asked for again next time). Null when nothing is missing. The pool
 *  does NOT wait for it before mounting: points already cached keep mounting while the worker works. */
export const requestSpawnChunks = (
  chunkKeys: string[],
  descriptors: SerializedActorDescriptor[]
): Promise<void> | null => {
  if (!client.isReady()) return null;
  const missing = chunkKeys.filter((k) => !clientChunkCache.has(k));
  if (missing.length === 0) return null;
  return client
    .request<SpawnsResult>({
      type: "GENERATE_SPAWNS",
      chunkKeys: missing,
      descriptors,
      budgetMs: SPAWN_BUDGET_MS,
    })
    .then((result) => {
      for (const key of result.done) {
        const sep = key.indexOf("_");
        clientChunkCache.set(
          key,
          emptyCachedChunk(Number(key.slice(0, sep)), Number(key.slice(sep + 1)))
        );
      }
      for (const p of result.points) {
        const entry = clientChunkCache.get(chunkKeyOf(p));
        if (entry) entry.points.push(p);
      }
    });
};

/** Every spawn point within `radius` of (x, z), generated as needed: the very points ActorPool mounts (an id
 *  found here is the id of the actor that will stand there). Always asked with the pool's WHOLE descriptor set:
 *  the cache is per chunk, so a chunk asked for one kind is done for every kind (asked for the beeble alone,
 *  the intro's host search left its chunks without buildings: only their far sprites drew), and kinds place
 *  around each other. Waits for the pool to boot the worker. */
export const loadSpawnPointsAround = async (x: number, z: number, radius: number): Promise<SpawnPoint[]> => {
  const descriptors = serializeDescriptors(getActiveActors());
  if (!ready) await new Promise<void>((wake) => readyWaiters.push(wake));
  await ready;
  const keys: string[] = [];
  const reach = radius + SPAWN_CHUNK_SIZE;
  for (let cx = Math.floor((x - radius) / SPAWN_CHUNK_SIZE); cx <= Math.floor((x + radius) / SPAWN_CHUNK_SIZE); cx++) {
    for (let cz = Math.floor((z - radius) / SPAWN_CHUNK_SIZE); cz <= Math.floor((z + radius) / SPAWN_CHUNK_SIZE); cz++) {
      if (Math.hypot((cx + 0.5) * SPAWN_CHUNK_SIZE - x, (cz + 0.5) * SPAWN_CHUNK_SIZE - z) <= reach) keys.push(`${cx}_${cz}`);
    }
  }
  // Each request is time-budgeted and may finish only some of the chunks; the pool's cache sweep may evict a
  // far chunk meanwhile, hence the cap.
  for (let round = 0; round < MAX_LOAD_ROUNDS; round++) {
    const request = requestSpawnChunks(keys, descriptors);
    if (!request) break;
    await request;
  }
  const points: SpawnPoint[] = [];
  for (const chunk of getCachedSpawnChunks(keys)) {
    for (const p of chunk.points) if (Math.hypot(p.x - x, p.z - z) <= radius) points.push(p);
  }
  return points;
};

/** The cache's own entries — point objects stay identity-stable while cached. */
export const getCachedSpawnChunks = (chunkKeys: string[]): CachedSpawnChunk[] => {
  const out: CachedSpawnChunk[] = [];
  for (const key of chunkKeys) {
    const entry = clientChunkCache.get(key);
    if (entry && entry.points.length > 0) out.push(entry);
  }
  return out;
};

// One-entry memo: the key set only changes when the player crosses a chunk,
// but the pool asks every batch (~49 objects + strings + a sort otherwise).
let nearbyKeysCX = NaN;
let nearbyKeysCZ = NaN;
let nearbyKeysDist = NaN;
let nearbyKeysCache: string[] = [];

/** Sorted nearest-first; returns a shared read-only array while the player stays in one chunk. */
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

  nearby.sort((a, b) => a.distSq - b.distSq);

  // The memoized order is a snapshot at fill time: it only quantizes the
  // worker's nearest-first scheduling to chunk granularity, never a chunk's contents.
  nearbyKeysCX = centerCX;
  nearbyKeysCZ = centerCZ;
  nearbyKeysDist = maxRenderDistance;
  nearbyKeysCache = nearby.map((n) => n.key);
  return nearbyKeysCache;
};

/** Same radius rule in both caches, so a revisited chunk regenerates in both together. */
export const cleanupSpawnCache = (
  playerX: number,
  playerZ: number,
  cleanupRadius: number
): void => {
  if (!client.exists()) return;
  client.post({ type: "CLEANUP", playerX, playerZ, cleanupRadius });

  const cleanupRadiusSq = cleanupRadius * cleanupRadius;
  clientChunkCache.forEach((entry, key) => {
    const dx = playerX - entry.centerX;
    const dz = playerZ - entry.centerZ;
    if (dx * dx + dz * dz > cleanupRadiusSq) clientChunkCache.delete(key);
  });
};

export const updateSpawnFootprint = (maxFootprint: number): void => {
  client.post({ type: "UPDATE_FOOTPRINT", maxFootprint });
};

