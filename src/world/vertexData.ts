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
 *  ~30–70ms hitch per new city tile the player walks into. Pads sit ABOVE
 *  the raw terrain, so below-raw-surface checks (embed rescue, fall-through
 *  backstop) stay sound. One-off callers (respawn) should keep the padded
 *  getVertexData. */
export const getVertexDataRaw = async (x: number, y: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexDataRaw(x, y);
};

