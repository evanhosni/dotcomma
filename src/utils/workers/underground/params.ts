/** The <Caves/> and <Sewers/> features: their kinds, defaults and who carries them. */

import { biomeFeature, biomeIdsWith } from "../biomeFlags";
import type { CaveParams, SewerParams } from "../types";

export const CAVES = "caves";
export const SEWERS = "sewers";

/** The biomes with a <Caves/> mounted (their slopes hold the mouths). */
export const caveBiomeIds = (): number[] => biomeIdsWith(CAVES);
export const caveParamsOf = (biomeId: number): CaveParams | null => biomeFeature<CaveParams>(biomeId, CAVES);

/** The biomes with a <Sewers/> mounted (under their streets). */
export const sewerBiomeIds = (): number[] => biomeIdsWith(SEWERS);
export const sewerParamsOf = (biomeId: number): SewerParams | null => biomeFeature<SewerParams>(biomeId, SEWERS);
