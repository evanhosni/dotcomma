import {
  computeVertexData,
  computeVertexDataRaw,
  initCompute,
  VertexResult,
} from "../workers/vertexCompute";
import { getActiveWorldConfig, whenWorldReady } from "./registry";

/**
 * Main-thread vertex queries (Player respawn raycasts, ad-hoc lookups).
 *
 * SINGLE SOURCE OF TRUTH: this is the same compute module the terrain, spawn,
 * and grass workers run (workers/vertexCompute.ts), initialized with the same
 * serialized WorldConfig from the registry. There is no separate main-thread
 * height implementation — biome heights are defined once, in the shared
 * pipeline (declarative per-biome noise configs + the city branch).
 */

let lastConfig: object | null = null;

const ensureInit = async (): Promise<void> => {
  await whenWorldReady();
  const config = getActiveWorldConfig();
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

