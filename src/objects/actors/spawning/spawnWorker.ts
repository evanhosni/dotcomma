import { DomainConfig } from "../../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../../utils/workers/workerClient";
import { AnyActorDescriptor, SerializedActorDescriptor, SpawnPoint } from "./types";

const SPAWN_CHUNK_SIZE = 250;

/** A time-budgeted request may finish only a prefix of the requested chunks. */
interface SpawnsResult {
  points: SpawnPoint[];
  done: string[];
}

let pendingInit: { config: DomainConfig; maxFootprint: number } | null = null;

const client = createWorkerClient({
  create: () => new Worker(new URL("../../../utils/workers/spawn.worker.ts", import.meta.url), { type: "module" }),
  init: () => pendingInit!,
  resultType: "SPAWNS_RESULT",
});

/** Always boots a FRESH worker (ActorPool re-inits on domain switch and footprint change). */
export const initSpawnWorker = (config: DomainConfig, maxFootprint: number): Promise<void> => {
  client.reset();
  pendingInit = { config, maxFootprint };
  return client.ensure();
};

export type { SerializedActorDescriptor };

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
  }));

// Client-side chunk cache: the pool re-requests ALL nearby chunks every batch,
// so without it the worker re-serialized hundreds of unchanged points each
// time. Entries carry their CENTER because parsing it out of the key made
// eviction the most expensive thing about the cache. Read-only outside this module.
export interface CachedSpawnChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
}

const clientChunkCache = new Map<string, CachedSpawnChunk>();

export const resetSpawnWorker = () => {
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

/** Chunk keys must arrive sorted nearest-first: the budget covers them in that
 *  order and the remainder is re-requested next batch. Returned buckets are
 *  the cache's own entries — point objects stay identity-stable while cached. */
export const generateSpawnPoints = async (
  chunkKeys: string[],
  descriptors: SerializedActorDescriptor[]
): Promise<CachedSpawnChunk[]> => {
  if (!client.isReady()) return [];

  const missing = chunkKeys.filter((k) => !clientChunkCache.has(k));

  if (missing.length > 0) {
    const result = await client.request<SpawnsResult>({
      type: "GENERATE_SPAWNS",
      chunkKeys: missing,
      descriptors,
      budgetMs: SPAWN_BUDGET_MS,
    });
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
  }

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

export { SPAWN_CHUNK_SIZE };
