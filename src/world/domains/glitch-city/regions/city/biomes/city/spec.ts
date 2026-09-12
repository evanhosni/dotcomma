import { CITY_BIOME_ID } from "../../../../../../constants";
import type { BiomeSpec } from "../../../../../../types";

/** The city biome as data — what <Biome spec> registers and the server's
 *  domain config (../../../../config.ts) lists. No `noise`: city heights are
 *  the bespoke city branch of the shared vertex pipeline (keyed by biome id). */
export const CITY_BIOME: BiomeSpec = {
  id: CITY_BIOME_ID,
  name: "city",
  joinable: true,
  blendable: false,
  blendWidth: 3,
};
