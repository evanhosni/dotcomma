import { declare } from "../../content";
import { BANK_DEFAULTS, BANKS, CHANNEL_BODY_KINDS } from "../../../generation/water/channel/params";
import type { BankReliefParams } from "../../../generation/water/types";

export interface BanksProps extends Partial<BankReliefParams> {}

/** BUMPY BANKS on the body of water this is mounted in (a <Rivers>, a <Pond>): where its channel's bank is
 *  held up over low ground (a levee), it takes the biome's OWN noise as relief instead of running smooth.
 *  Nothing is drawn — the bank is terrain, so the height pipeline reads this straight from the body's
 *  parts (water/channel/). A lake's shore is no carved bank: mounted in a <Lake> it is a content error. */
export const Banks = declare<BanksProps>({
  kind: BANKS,
  within: CHANNEL_BODY_KINDS,
  read: (node): BankReliefParams => ({ ...BANK_DEFAULTS, ...node.props }),
});
