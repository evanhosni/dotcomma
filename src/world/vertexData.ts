import { computeVertexData, initCompute, VertexResult } from "../workers/vertexCompute";
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

export const getVertexData = async (x: number, y: number): Promise<VertexResult> => {
  await whenWorldReady();
  const config = getActiveWorldConfig();
  if (config !== lastConfig) {
    initCompute(config);
    lastConfig = config;
  }
  return computeVertexData(x, y);
};
