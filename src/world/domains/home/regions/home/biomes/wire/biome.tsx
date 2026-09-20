import { Biome } from "../../../../../../components";

import { WIRE_BIOME_ID } from "../../../../../../constants";
export { WIRE_BIOME_ID };

/** Config-only (height 0, nothing renders): exists so the analytic height pipeline has a biome. */
export const WireBiome = () => <Biome name="wire" id={WIRE_BIOME_ID} joinable blendable />;
