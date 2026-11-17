import type { TerrainNoiseParams } from "../../generation/types";

/** Zero relief: the base and road noise of a flat domain (home, 404). */
export const FLAT_NOISE: TerrainNoiseParams = { type: "perlin", octaves: 1, persistence: 1, lacunarity: 1, exponentiation: 1, height: 0, scale: 1000 };
