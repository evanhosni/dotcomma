import { declare } from "../content";
import type { BiomeNoiseConfig } from "../types";

export type DomeProps = NonNullable<BiomeNoiseConfig["dome"]>;

/** A DOME under the noise: the ground rises with the square of the depth inside the biome,
 *  measured across joined cells, so a joined group is ONE massif. */
export const Dome = declare<DomeProps>({ kind: "dome", within: "noise" });
