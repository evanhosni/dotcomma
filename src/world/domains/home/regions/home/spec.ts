import type { RegionSpec } from "../../../../types";
import { WIRE_BIOME } from "./biomes/wire/spec";

/** No baseNoise: the home domain's own flat base noise. Never mounted alongside the game regions. */
export const HOME_REGION: RegionSpec = {
  id: 0,
  name: "home",
  biomes: [WIRE_BIOME],
};
