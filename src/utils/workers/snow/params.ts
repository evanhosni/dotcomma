/** The <Snow/> feature: its kind, the defaults its props override, and who carries it. */

import { biomeFeature, biomeIdsWith } from "../biomeFlags";
import type { SnowParams } from "../types";

export const SNOW = "snow";

export const SNOW_DEFAULTS: SnowParams = {
  // Ground height, real units: nothing lies below the foot, whole from the top.
  lineLow: 40,
  lineHigh: 100,
  // The altitude term (deeper, flatter-shouldered snow) over this band of ground height.
  altitudeLow: 20,
  altitudeHigh: 250,
  depthScale: 1,
};

/** The biomes with a <Snow/> mounted. */
export const snowBiomeIds = (): number[] => biomeIdsWith(SNOW);
export const snowParamsOf = (biomeId: number): SnowParams | null => biomeFeature<SnowParams>(biomeId, SNOW);
