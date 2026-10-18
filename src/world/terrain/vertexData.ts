import {
  computeVertexData,
  initCompute,
  VertexResult,
} from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, whenDomainReady } from "../domains/utils";

// Main-thread adapter over the SAME compute module the workers run — never a second height implementation.
// For one-off queries only (a teleport, a fall reset): a frequent one samples on the worker (getVertexSample).

let lastConfig: object | null = null;

/** Initializes the main-thread compute module with the active domain's config
 *  (once per commit). Callers that use vertexCompute's place/address helpers
 *  directly await this first. */
export const ensureVertexCompute = async (): Promise<void> => {
  await whenDomainReady();
  const config = getActiveDomainConfig();
  if (config !== lastConfig) {
    initCompute(config);
    lastConfig = config;
  }
};

export const getVertexData = async (x: number, z: number): Promise<VertexResult> => {
  await ensureVertexCompute();
  return computeVertexData(x, z);
};

/** A height sample computed in the dressing worker, padded or raw: what any FREQUENT caller uses (a
 *  flatten-tile miss is 30–70ms and a cell's first river list and road network ~70ms on this thread).
 *  null until the worker is up. */
export { getVertexSample } from "../../objects/dressing/dressingWorker";
