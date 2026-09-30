import type { RegionSpec } from "../../../../types";
import { DUST_BIOME } from "./biomes/dust/spec";
import { SALT_BIOME } from "./biomes/salt/spec";

/** Its OWN base noise — broad simplex swells — so crossing in reads as the land itself
 *  changing. Few rivers: a desert is dry. */
export const DESERT_REGION: RegionSpec = {
  id: 2,
  name: "desert",
  biomes: [DUST_BIOME, SALT_BIOME],
  baseNoise: {
    type: "simplex",
    octaves: 2,
    persistence: 1.2,
    lacunarity: 2,
    exponentiation: 1,
    height: 260,
    scale: 1800,
  },
  riverProbability: 0.15,
};
