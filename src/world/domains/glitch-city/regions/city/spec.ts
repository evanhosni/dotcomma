import type { RegionSpec } from "../../../domainConfig";
import { CITY_BIOME } from "./biomes/city/spec";
import { CITY_GRASS_BIOME } from "./biomes/grass/spec";

/** The city region as data. BIOME ORDER IS THE VORONOI ORDER and must match
 *  region.tsx's JSX order (the <Domain> commit checks it in dev). */
export const CITY_REGION: RegionSpec = {
  id: 3,
  name: "city",
  biomes: [CITY_BIOME, CITY_GRASS_BIOME],
};
