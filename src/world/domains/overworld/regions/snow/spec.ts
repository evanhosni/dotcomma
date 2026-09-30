import type { RegionSpec } from "../../../../types";
import { MOUNTAIN_BIOME } from "./biomes/mountain/spec";
import { TUNDRA_BIOME } from "./biomes/tundra/spec";

/** Big, slow relief under low tundra and mountain tops. Wet: many rivers. */
export const SNOW_REGION: RegionSpec = {
  id: 3,
  name: "snow",
  biomes: [TUNDRA_BIOME, MOUNTAIN_BIOME],
  baseNoise: {
    type: "perlin",
    octaves: 3,
    persistence: 2,
    lacunarity: 2,
    exponentiation: 2,
    height: 600,
    scale: 4000,
  },
  riverProbability: 0.55,
};
