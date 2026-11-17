/** Typed wrappers over the ONE foliage worker (objects/foliage/foliage.worker.ts), shared by every field. */

import { DomainConfig } from "../../generation";
import type { WaterZone } from "../../generation/water/types";
import type { WaterBodyRef } from "../../world/components/water/types";
import { createWorkerClient } from "../../utils/worker-client";

/** One chunk request (objects/foliage/foliage.worker.ts reads this type too). */
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
  /** Mounted in a body of water (<Lake>, <Rivers>, <Pond>): placed by the share of the water there that
   *  body owns (VertexResult.waterBody) instead of by a biome's weight. */
  waterBody?: WaterBodyRef;
  /** Where it grows by the water over the ground (the one zone rule, generation/water/params.ts): submerged blades
   *  are cut to the depth (`bladeHeight` tall uncut); unset = dry ground only. */
  zone?: WaterZone;
  bladeHeight?: number;
  /** Submerged blades: the shallowest water, the tip's clearance under the surface, the least cut share. */
  submergedMinDepth: number;
  tipClearance: number;
  minCutScale: number;
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
  create: () => new Worker(new URL("./foliage.worker.ts", import.meta.url), { type: "module" }),
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
