/** The snow flag's defaults (`snow: true` on a biome spec = these; an object overrides any of them). */

import type { SnowParams } from "../types";

export const SNOW_DEFAULTS: SnowParams = {
  // Ground height, real units: nothing lies below the foot, whole from the top.
  lineLow: 40,
  lineHigh: 100,
  // The altitude term (deeper, flatter-shouldered snow) over this band of ground height.
  altitudeLow: 20,
  altitudeHigh: 250,
  depthScale: 1,
};
