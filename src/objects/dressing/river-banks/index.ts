import { declare } from "../../../world/content";
import { RIVER_BANK_RELIEF_DEFAULTS, RIVER_BANKS } from "../../../utils/workers/rivers/bankParams";
import type { RiverBankReliefParams } from "../../../utils/workers/types";

export interface RiverBanksProps extends Partial<RiverBankReliefParams> {}

/** BUMPY RIVER BANKS on the biome this is mounted in: where a river's bank is held up over low
 *  ground (a levee), it takes this biome's OWN noise as relief instead of running smooth. Nothing
 *  is drawn — the bank is terrain, so the height pipeline reads this straight from the config. */
export const RiverBanks = declare<RiverBanksProps>({
  kind: RIVER_BANKS,
  within: "biome",
  read: (node) => ({ ...RIVER_BANK_RELIEF_DEFAULTS, ...node.props }),
});
