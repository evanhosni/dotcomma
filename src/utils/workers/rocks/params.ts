/** The <Rocks/> feature: its kind, the defaults its props override, and who carries it. */

import { biomeFeature, biomeIdsWith } from "../biomeFlags";
import type { RockParams } from "../types";

export const ROCKS = "rocks";

export const ROCK_DEFAULTS: RockParams = {
  // Rocks per km², the spacing between them, and their sizes (cubically biased small).
  density: 900,
  footprint: 5,
  sizeMin: 0.4,
  sizeMax: 13.5,
  // The share of flat points kept, rising to all between these slopes (steeper ground keeps more).
  flatKeep: 0.12,
  startDeg: 10,
  fullDeg: 32,
  texture: "dirt.png",
};

/** The biomes with a <Rocks/> field mounted. */
export const rockFieldBiomeIds = (): number[] => biomeIdsWith(ROCKS);
export const rockParamsOf = (biomeId: number): RockParams | null => biomeFeature<RockParams>(biomeId, ROCKS);
