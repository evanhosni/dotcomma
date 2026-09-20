import {
  computeVertexData,
  computeVertexDataRaw,
  initCompute,
  VertexResult,
} from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, whenDomainReady } from "../domains/utils";

// Main-thread adapter over the SAME compute module the workers run — never a second height implementation.

let lastConfig: object | null = null;

const ensureInit = async (): Promise<void> => {
  await whenDomainReady();
  const config = getActiveDomainConfig();
  if (config !== lastConfig) {
    initCompute(config);
    lastConfig = config;
  }
};

export const getVertexData = async (x: number, z: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexData(x, z);
};

/** PAD-FREE height for frequent callers (the padded path can spend 30–70ms
 *  building a flatten tile). NOT a lower bound on the real surface: pads
 *  EXCAVATE (up to 8.3u measured), so use it only as a pre-filter and confirm
 *  with the padded height before acting (Player.tsx resolveEmbeddedSurface). */
export const getVertexDataRaw = async (x: number, z: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexDataRaw(x, z);
};

/** PADDED height computed in the dressing worker (absorbs the flatten-tile
 *  cost). null until the worker is up — fall back to getVertexData. */
export { getVertexSample } from "../../objects/dressing/dressingWorker";

