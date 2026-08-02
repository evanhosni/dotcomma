/**
 * Grass blade generation — worker client.
 *
 * The placement algorithm runs in grass.worker.ts (coarse terrain grid +
 * bilinear interpolation per blade). One shared worker serves every
 * GrassField instance; results come back as transferable Float32Arrays.
 */

import { WorldConfig } from "../../workers/vertexCompute";

export interface GrassChunkParams {
  seed: string;
  chunkSize: number;
  density: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  slopeBlend: number;
}

export interface GrassChunkResult {
  count: number;
  minY: number;
  maxY: number;
  offsets: Float32Array; // x, y, z per blade
  bladeData: Float32Array; // phase, scale, tint per blade
}

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
const pendingRequests = new Map<number, (result: GrassChunkResult) => void>();
let nextRequestId = 0;

const handleMessage = (e: MessageEvent) => {
  if (e.data.type === "GRASS_RESULT") {
    const resolve = pendingRequests.get(e.data.id);
    if (resolve) {
      const { count, minY, maxY, offsets, bladeData } = e.data;
      resolve({ count, minY, maxY, offsets, bladeData });
      pendingRequests.delete(e.data.id);
    }
  }
};

/**
 * Initialize the shared grass worker. Idempotent — safe to call from
 * multiple GrassField instances.
 */
export const initGrassWorker = (config: WorldConfig): Promise<void> => {
  if (initPromise) return initPromise;

  worker = new Worker(new URL("../../workers/grass.worker.ts", import.meta.url), { type: "module" });

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

/**
 * Generate blade transforms for one grass chunk.
 */
export const generateGrassChunk = (
  chunkX: number,
  chunkZ: number,
  params: GrassChunkParams
): Promise<GrassChunkResult> => {
  if (!worker) {
    return Promise.resolve({ count: 0, minY: 0, maxY: 0, offsets: new Float32Array(0), bladeData: new Float32Array(0) });
  }

  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    worker!.postMessage({ type: "GENERATE_GRASS", id, chunkX, chunkZ, params });
  });
};
