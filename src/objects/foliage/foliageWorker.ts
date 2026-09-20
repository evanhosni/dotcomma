/** Typed wrappers over the ONE foliage worker (utils/workers/foliage.worker.ts), shared by every field. */

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
  offsets: Float32Array; // x, y, z per instance
  instanceData: Float32Array; // phase, scale, tint per instance
}

let configForNextBoot: DomainConfig | null = null;

const client = createWorkerClient({
  create: () => new Worker(new URL("../../utils/workers/foliage.worker.ts", import.meta.url), { type: "module" }),
  init: () => ({ config: configForNextBoot }),
  resultType: "FOLIAGE_RESULT",
});

export const resetFoliageWorker = client.reset;

/** Idempotent — every mounted field calls it. */
export const initFoliageWorker = (config: DomainConfig): Promise<void> => {
  if (!client.exists()) configForNextBoot = config;
  return client.ensure();
};

const EMPTY_RESULT: FoliageChunkResult = {
  count: 0,
  minY: 0,
  maxY: 0,
  offsets: new Float32Array(0),
  instanceData: new Float32Array(0),
};

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
