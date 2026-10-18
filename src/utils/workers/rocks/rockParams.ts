/** The rocks flag's defaults (`rocks: true` on a biome spec = these; an object overrides any of them). */

import type { RockParams } from "../types";

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
