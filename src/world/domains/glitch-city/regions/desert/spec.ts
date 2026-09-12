import type { RegionSpec } from "../../../domainConfig";
import { DUST_BIOME } from "./biomes/dust/spec";

/** The desert region as data (see city/spec.ts for the ordering rule). */
export const DESERT_REGION: RegionSpec = {
  id: 2,
  name: "desert",
  biomes: [DUST_BIOME],
};
