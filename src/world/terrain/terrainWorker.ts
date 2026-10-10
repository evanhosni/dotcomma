import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig } from "../domains/utils";
import type { LODLevel } from "./lodConfig";

// Worker clients for terrain.worker.ts (heights, blend fields, normals and collider heights per chunk).

/** One chunk's buffers, per main-grid vertex (the skirt is filled on the main thread, chunkGeometry.ts). */
export interface ChunkBuildResult {
  heights: Float32Array;
  /** count × slots, interleaved per vertex (world/terrain/material.ts owns the slot → biome mapping). */
  biomeSdf: Float32Array;
  biomePresence: Float32Array;
  /** count × slots: the riverbed texture's slot distances (VertexResult.riverbedSdf). */
  riverbedSdf: Float32Array;
  slots: number;
  riverBed: Float32Array;
  distRoad: Float32Array;
  distFreeway: Float32Array;
  freewayAlong: Float32Array;
  normals: Float32Array;
  /** Water surface per vertex (NaN = none); null when nothing in the chunk is under water. */
  waterHeights: Float32Array | null;
  /** Rapier column-major heightfield; null unless the LOD has a collider. */
  colliderHeights: Float32Array | null;
}

/** A POOL of terrain workers: the startup ring is worker-bound (one worker idled every other core). The
 *  pipeline is a pure function of position whatever a worker's caches hold — the spawn/foliage/dressing
 *  workers and the server already evaluate it independently and must agree — so any worker may build any
 *  chunk (MEASURED: 30 LOD1/LOD2 chunks built on two workers in opposite orders, 4.5M values, bit-identical).
 *  Each worker keeps its own caches (+30–50MB of heap each), hence the cap — a city spawn's startup ring
 *  (16 cores) took 7.1s on one worker, 6.1s on two, 6.0s on three; the spawn, foliage, dressing and
 *  collider workers keep a core each. */
const MAX_TERRAIN_WORKERS = 2;
const OTHER_WORKERS = 4;
export const TERRAIN_WORKER_COUNT = Math.max(
  1,
  Math.min(MAX_TERRAIN_WORKERS, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2) - 1 - OTHER_WORKERS),
);

const createTerrainClient = () =>
  createWorkerClient({
    create: () => new Worker(new URL("../../utils/workers/terrain.worker.ts", import.meta.url), { type: "module" }),
    init: () => ({ config: getActiveDomainConfig() }),
    resultType: "CHUNK_BUILT",
  });

const pool = Array.from({ length: TERRAIN_WORKER_COUNT }, () => ({ client: createTerrainClient(), pending: 0 }));

/** Neighboring chunks share cells (networks, river lists, flatten tiles): a chunk prefers the worker its
 *  area hashes to, so their caches split by area instead of every worker warming every cell. */
const AFFINITY_CELL = 1680;
const affinityOf = (x: number, z: number): number => {
  const cx = Math.floor(x / AFFINITY_CELL);
  const cz = Math.floor(z / AFFINITY_CELL);
  return (((cx * 73856093) ^ (cz * 19349663)) >>> 0) % pool.length;
};

/** The least-loaded worker; the area's own worker unless another is idle while it is busy. */
const pickWorker = (x: number, z: number) => {
  const own = pool[affinityOf(x, z)];
  let best = own;
  for (const w of pool) if (w.pending < best.pending - 1 || (w.pending === 0 && best.pending > 0)) best = w;
  return best;
};

export const ensureTerrainWorker = async (): Promise<void> => {
  await Promise.all(pool.map((w) => w.client.ensure()));
};

/** Domain switch: the next request boots fresh workers from the new commit. */
export const resetTerrainWorker = (): void => {
  for (const w of pool) {
    w.client.reset();
    w.pending = 0;
  }
};

/** Visual-only LODs skip flatten pads: a LOD4 chunk spans ~64 pad tiles, and computing them made far
 *  city builds ~9× slower (stalling spawning too). */
export const requestChunkBuild = (lod: LODLevel, centerX: number, centerZ: number): Promise<ChunkBuildResult> => {
  const worker = pickWorker(centerX, centerZ);
  worker.pending++;
  // A reset drops in-flight requests (they never settle) and zeroes the count.
  const done = () => {
    if (worker.pending > 0) worker.pending--;
  };
  const request = worker.client.request<ChunkBuildResult>({
    type: "BUILD_CHUNK",
    segments: lod.segments,
    chunkSize: lod.chunkSize,
    offsetX: centerX,
    offsetZ: centerZ,
    visualOnly: !lod.hasCollider,
    carvesRivers: lod.carvesRivers,
    cutsDecks: lod.cutsDecks,
    needCollider: lod.hasCollider,
  });
  request.then(done, done);
  return request;
};
