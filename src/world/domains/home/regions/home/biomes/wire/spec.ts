import type { BiomeSpec } from "../../../../../../types";

/** Config-only (no noise = height 0, nothing renders): the analytic height pipeline needs a biome. */
export const WIRE_BIOME: BiomeSpec = {
  id: 4,
  name: "wire",
  joinable: true,
};
