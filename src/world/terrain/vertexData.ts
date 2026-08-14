import {
  computeVertexData,
  computeVertexDataRaw,
  initCompute,
  VertexResult,
} from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, whenDomainReady } from "../domains/utils";

/**
 * Main-thread vertex queries (Player respawn raycasts, ad-hoc lookups).
 *
 * SINGLE SOURCE OF TRUTH: this is the same compute module the terrain, spawn,
 * and grass workers run (workers/vertexCompute.ts), initialized with the same
 * serialized DomainConfig from the active domain. There is no separate main-thread
 * height implementation — biome heights are defined once, in the shared
 * pipeline (declarative per-biome noise configs + the city branch).
 */

let lastConfig: object | null = null;

const ensureInit = async (): Promise<void> => {
  await whenDomainReady();
  const config = getActiveDomainConfig();
  if (config !== lastConfig) {
    initCompute(config);
    lastConfig = config;
  }
};

export const getVertexData = async (x: number, y: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexData(x, y);
};

/** PAD-FREE vertex data for FREQUENT main-thread callers (player ground
 *  checks): the padded path computes flatten-pad tiles synchronously — a
 *  ~30–70ms hitch per new city tile the player walks into.
 *
 *  WARNING: this is NOT a lower bound on the real surface. Pads EXCAVATE as
 *  well as fill — they lerp terrain toward the actor's own ground height, so
 *  uphill of a building on a slope the true ground sits BELOW this height
 *  (measured up to 8.3u; 6% of pads exceed 2u). A below-surface test that
 *  trusts this alone will fire on solid ground — it made the player's
 *  fall-through backstop teleport them out of a building's excavation every
 *  few frames. Use it as a cheap PRE-FILTER and confirm with getVertexData
 *  before acting (see resolveEmbeddedSurface in player/Player.tsx). */
export const getVertexDataRaw = async (x: number, y: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexDataRaw(x, y);
};

/** PADDED vertex data computed OFF-THREAD (in the dressing worker — it idles
 *  most of the time and runs the same pipeline). This is the safe way for a
 *  frequent caller to confirm a raw pre-filter hit: a flatten-tile miss
 *  inside the padded path costs 30–70ms, which the worker absorbs instead of
 *  the frame. Returns null until the worker is initialized — fall back to
 *  getVertexData (main thread, may hitch) for one-off callers that need an
 *  answer regardless. */
export { getVertexSample } from "../../objects/dressing/dressingWorker";

