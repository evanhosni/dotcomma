import { isMachineStruggling } from "../../utils/task-queue/TaskQueue";
import type { LODLevel } from "./lodConfig";
import { computeDesiredChunks } from "./lodQuadtree";
import { type ChunkBuildResult, requestChunkBuild, TERRAIN_WORKER_COUNT } from "./terrainWorker";
import type { Chunk } from "./types";

// The terrain worker request PIPELINE: how many chunk builds are in flight, which are requested ahead of
// their turn (the build queue's next chunks, and a destination's chunks before the update pass gets
// there), and which promise each chunk awaits. TerrainRenderer decides the build order; this keeps the
// workers fed in that order.

/** Worker requests kept in flight, the chunk being finished included. A worker handles one message at a
 *  time, so with a single request it idled from posting each result until the next frame's pass asked for
 *  the next chunk, and through every main-thread stall (a shader link during the load is 100s of ms). */
const REQUESTS_IN_FLIGHT = TERRAIN_WORKER_COUNT * 2 + 1;
/** While the terrain gate is closed the player is held at the spawn, so the build order cannot change and a
 *  deep queue costs nothing; it carries the worker through the load's shader links (each 300–700ms). */
const LOADING_REQUESTS_IN_FLIGHT = 16;
let loadingTerrain = true;
const requestCap = (): number => (loadingTerrain ? LOADING_REQUESTS_IN_FLIGHT : REQUESTS_IN_FLIGHT);
let requestsInFlight = 0;
/** Bumped by a domain reset: requests to the terminated worker never settle and must not be counted. */
let requestGeneration = 0;

/** The terrain gate: closed (true) while the player is held at the spawn. */
export const setTerrainLoading = (loading: boolean): void => {
  loadingTerrain = loading;
};

const trackedBuildRequest = (lod: LODLevel, x: number, z: number): Promise<ChunkBuildResult> => {
  const generation = requestGeneration;
  requestsInFlight++;
  const settle = () => {
    if (generation === requestGeneration) requestsInFlight--;
  };
  const request = requestChunkBuild(lod, x, z);
  request.then(settle, settle);
  return request;
};

/** The chunk's worker build: the one requested ahead of its turn, else a new request. */
export const requestBuildOf = (chunk: Chunk): Promise<ChunkBuildResult> =>
  (chunk.request ??= trackedBuildRequest(chunk.lod, chunk.offset.x, chunk.offset.z));

/** Builds requested around a destination before the update pass gets there — at the load, before the
 *  terrain material exists (its textures and the load's shader links take seconds, through which the worker
 *  sat idle), and from FastTravel as soon as a destination is resolved — adopted by a new chunk. */
const earlyRequests = new Map<string, Promise<ChunkBuildResult>>();
let earlyOrder: { key: string; x: number; z: number; lod: LODLevel }[] = [];
let earlyAtX = NaN;
let earlyAtZ = NaN;

/** Fills the free request slots with the chunks around (x, z) in build order (LOD1 first, nearest first). */
export const prefetchTerrainAround = (x: number, z: number): void => {
  if (x !== earlyAtX || z !== earlyAtZ) {
    earlyAtX = x;
    earlyAtZ = z;
    earlyRequests.clear();
    const desired = computeDesiredChunks(x, z);
    earlyOrder = Object.keys(desired).map((key) => {
      const { position, lod } = desired[key];
      return { key, x: position[0], z: position[1], lod };
    });
    earlyOrder.sort((a, b) => a.lod.level - b.lod.level || (a.x - x) ** 2 + (a.z - z) ** 2 - (b.x - x) ** 2 - (b.z - z) ** 2);
  }
  for (const c of earlyOrder) {
    if (requestsInFlight >= requestCap()) return;
    if (!earlyRequests.has(c.key)) earlyRequests.set(c.key, trackedBuildRequest(c.lod, c.x, c.z));
  }
};

/** The early request for a chunk key, handed over once; null if there is none. */
export const adoptEarlyRequest = (key: string): Promise<ChunkBuildResult> | null => {
  const request = earlyRequests.get(key);
  if (!request) return null;
  earlyRequests.delete(key);
  return request;
};

export const dropEarlyRequests = (): void => {
  earlyRequests.clear();
  earlyOrder = [];
  earlyAtX = NaN;
  earlyAtZ = NaN;
};

/** Requests the next chunks of `queue` (built from its END) ahead of their turn, so the worker always has the
 *  next one queued. Far chunks the struggling machine would defer are not requested early either. */
export const prefetchQueuedBuilds = (queue: readonly Chunk[], terrainLoaded: boolean): void => {
  for (let i = queue.length - 1; i >= 0 && requestsInFlight < requestCap(); i--) {
    const chunk = queue[i];
    if (chunk.request) continue;
    if (terrainLoaded && !chunk.lod.hasCollider && isMachineStruggling()) break;
    requestBuildOf(chunk);
  }
};

/** Domain switch: the terminated workers' requests never settle, so nothing in flight is counted. */
export const resetBuildRequests = (): void => {
  requestsInFlight = 0;
  requestGeneration++;
  loadingTerrain = true;
  dropEarlyRequests();
};
