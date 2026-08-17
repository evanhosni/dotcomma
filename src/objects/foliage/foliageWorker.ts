/**
 * Foliage placement — worker client (shared by every foliage feature).
 *
 * The placement algorithm runs in utils/workers/foliage.worker.ts (coarse
 * terrain grid + bilinear interpolation per instance). ONE shared worker
 * serves every mounted field, whatever the plant; results come back as
 * transferable Float32Arrays that go straight into GPU instance attributes.
 */

import { DomainConfig } from "../../utils/workers/vertexCompute";

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

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
const pendingRequests = new Map<number, (result: FoliageChunkResult) => void>();
let nextRequestId = 0;

const handleMessage = (e: MessageEvent) => {
  if (e.data.type === "FOLIAGE_RESULT") {
    const resolve = pendingRequests.get(e.data.id);
    if (resolve) {
      const { count, minY, maxY, offsets, instanceData } = e.data;
      resolve({ count, minY, maxY, offsets, instanceData });
      pendingRequests.delete(e.data.id);
    }
  }
};

/** Domain switch (resetDomainSystems): drop the worker so the next foliage
 *  field mount re-inits it with the new world's config. */
export const resetFoliageWorker = () => {
  worker?.terminate();
  worker = null;
  initPromise = null;
  pendingRequests.clear();
};

/**
 * Initialize the shared foliage worker. Idempotent — safe to call from
 * every mounted field.
 */
export const initFoliageWorker = (config: DomainConfig): Promise<void> => {
  if (initPromise) return initPromise;

  worker = new Worker(new URL("../../utils/workers/foliage.worker.ts", import.meta.url), { type: "module" });

  initPromise = new Promise((resolve) => {
    worker!.onmessage = (e: MessageEvent) => {
      if (e.data.type === "INIT_DONE") {
        worker!.onmessage = handleMessage;
        resolve();
      }
    };
    worker!.postMessage({ type: "INIT", config });
  });

  return initPromise;
};

/** Generate the instance transforms for one foliage chunk. */
export const generateFoliageChunk = (
  chunkX: number,
  chunkZ: number,
  params: FoliageChunkParams
): Promise<FoliageChunkResult> => {
  if (!worker) {
    return Promise.resolve({ count: 0, minY: 0, maxY: 0, offsets: new Float32Array(0), instanceData: new Float32Array(0) });
  }

  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    worker!.postMessage({ type: "GENERATE_FOLIAGE", id, chunkX, chunkZ, params });
  });
};
