/**
 * Foliage placement — worker client (shared by every foliage feature).
 *
 * The placement algorithm runs in utils/workers/foliage.worker.ts (coarse
 * terrain grid + bilinear interpolation per instance). ONE shared worker
 * serves every mounted field, whatever the plant; results come back as
 * transferable Float32Arrays that go straight into GPU instance attributes.
 *
 * Lifecycle/plumbing comes from the shared worker-client base.
 */

import { DomainConfig } from "../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../utils/workers/workerClient";

export interface FoliageChunkParams {
  seed: string;
  chunkSize: number;
  density: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  slopeBlend: number;
}

export interface FoliageChunkResult {
  count: number;
  minY: number;
  maxY: number;
  offsets: Float32Array; // x, y, z per blade
  instanceData: Float32Array; // phase, scale, tint per blade
}

/** Config handed to the next boot (initFoliageWorker sets it before ensure). */
let pendingConfig: DomainConfig | null = null;

const client = createWorkerClient({
  create: () => new Worker(new URL("../../utils/workers/foliage.worker.ts", import.meta.url), { type: "module" }),
  init: () => ({ config: pendingConfig }),
  resultType: "FOLIAGE_RESULT",
});

/** Domain switch (resetDomainSystems): drop the worker so the next foliage
 *  field mount re-inits it with the new world's config. */
export const resetFoliageWorker = client.reset;

/**
 * Initialize the shared foliage worker. Idempotent — safe to call from
 * every mounted field.
 */
export const initFoliageWorker = (config: DomainConfig): Promise<void> => {
  if (!client.exists()) pendingConfig = config;
  return client.ensure();
};

const EMPTY_RESULT: FoliageChunkResult = {
  count: 0,
  minY: 0,
  maxY: 0,
  offsets: new Float32Array(0),
  instanceData: new Float32Array(0),
};

/** Generate the instance transforms for one foliage chunk. */
export const generateFoliageChunk = (
  chunkX: number,
  chunkZ: number,
  params: FoliageChunkParams
): Promise<FoliageChunkResult> => {
  if (!client.exists()) return Promise.resolve(EMPTY_RESULT);
  return client
    .request<FoliageChunkResult>({ type: "GENERATE_FOLIAGE", chunkX, chunkZ, params })
    .then(({ count, minY, maxY, offsets, instanceData }) => ({ count, minY, maxY, offsets, instanceData }));
};
