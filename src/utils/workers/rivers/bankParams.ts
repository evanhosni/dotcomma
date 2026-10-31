/** The <RiverBanks/> feature: a levee bank here takes the biome's own noise as bumps. */

import { biomeFeature } from "../biomeFlags";
import type { RiverBankReliefParams } from "../types";

export const RIVER_BANKS = "riverBanks";

/** MEASURED over a mountain patch: its detail layers run −20…+29u (std 8.7), the grass ±35 (std 12), the
 *  tundra ±8. At the noise's own wavelengths (the mountain's 400u and 150u) the relief read as one smooth
 *  swell over a 36u bank, hence the same noise again 3× finer (rivers/DECISIONS.md "A levee bank takes its
 *  biome's noise"). */
export const RIVER_BANK_RELIEF_DEFAULTS: RiverBankReliefParams = {
  share: 0.7,
  fineScale: 3,
  fineShare: 0.8,
};

export const riverBankReliefOf = (biomeId: number): RiverBankReliefParams | null =>
  biomeFeature<RiverBankReliefParams>(biomeId, RIVER_BANKS);
