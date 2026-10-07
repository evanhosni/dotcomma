/** Typed wrappers over the ONE foliage worker (utils/workers/foliage.worker.ts), shared by every field. */

import { DomainConfig } from "../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../utils/workers/workerClient";

/** One chunk request (utils/workers/foliage.worker.ts reads this type too). */
export interface FoliageChunkParams {
  seed: string;
  chunkSize: number;
  /** Blades per 1,000,000 sq units. */
  density: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  /** Degrees. */
  slopeRange?: [number, number];
  /** Degrees over which density fades at the slopeRange edges. */
  slopeBlend: number;
  /** Normalized street units from the nearest road centerline (freeways included) — blades stay off asphalt. */
  roadDistanceRange?: [number, number];
  /** Only under water, `height` = the blade height (it is cut to the water's depth). */
  underwater?: { height: number };
}

export interface FoliageChunkResult {
  /** Blades delivered: the first ceil(total × band) of the fade-key order. */
  count: number;
  /** Blades the chunk places in full — what the draw truncation is a fraction of. */
  total: number;
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
  total: 0,
  minY: 0,
  maxY: 0,
  offsets: new Float32Array(0),
  instanceData: new Float32Array(0),
};

/** `band` (0, 1]: the fraction of the chunk's fade-key-sorted blades to deliver — a wider band of
 *  the same chunk is a strict superset prefix of a narrower one. */
export const generateFoliageChunk = (
  chunkX: number,
  chunkZ: number,
  params: FoliageChunkParams,
  band: number,
): Promise<FoliageChunkResult> => {
  if (!client.exists()) return Promise.resolve(EMPTY_RESULT);
  return client
    .request<FoliageChunkResult>({ type: "GENERATE_FOLIAGE", chunkX, chunkZ, params, band })
    .then(({ count, total, minY, maxY, offsets, instanceData }) => ({ count, total, minY, maxY, offsets, instanceData }));
};
