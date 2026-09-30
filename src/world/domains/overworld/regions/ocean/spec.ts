import type { RegionSpec } from "../../../../types";
import { LAKE_BIOME } from "./biomes/lake/spec";

/** Lake biomes on a nearly flat base (so every lake's level and shore agree), and rivers
 *  feeding in from every side. */
export const OCEAN_REGION: RegionSpec = {
  id: 4,
  name: "ocean",
  biomes: [LAKE_BIOME],
  baseNoise: {
    type: "perlin",
    octaves: 2,
    persistence: 1,
    lacunarity: 2,
    exponentiation: 1,
    height: 24,
    scale: 3000,
  },
  riverProbability: 0.6,
};
