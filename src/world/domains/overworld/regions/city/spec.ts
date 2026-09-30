import type { RegionSpec } from "../../../../types";
import { DEFAULT_TERRAIN_PARAMS } from "../../../../defaults";
import { CITY_BIOME } from "./biomes/city/spec";
import { GRASS_BIOME } from "./biomes/grass/spec";

/** City blocks interleaved with grassland on the classic rolling base noise. */
export const CITY_REGION: RegionSpec = {
  id: 1,
  name: "city",
  biomes: [CITY_BIOME, GRASS_BIOME],
  baseNoise: DEFAULT_TERRAIN_PARAMS.baseNoise,
  riverProbability: 0.35,
};
