import { declare } from "../content";
import type { TerrainNoiseParams } from "../../utils/workers/types";
import type { BiomeNoiseConfig } from "../types";
import type { ReactNode } from "react";

export interface NoiseProps {
  params: TerrainNoiseParams;
  /** Folds the noise about zero (ridges). */
  absNeg?: boolean;
  scale?: number;
  offset?: number;
  children?: ReactNode;
}

/** The RELIEF of whatever it is mounted in: a region's base terrain, or a biome's own height over
 *  it. A biome with bespoke height code in the pipeline (the city) mounts none. */
export const Noise = declare<NoiseProps>({ kind: "noise", within: ["region", "biome"] });

export type DomeProps = NonNullable<BiomeNoiseConfig["dome"]>;

/** A DOME under the noise: the ground rises with the square of the depth inside the biome,
 *  measured across joined cells, so a joined group is ONE massif. A domed biome is ROCK — rivers
 *  build through it (waterfalls, pools, springs) and caves open in it. */
export const Dome = declare<DomeProps>({ kind: "dome", within: "noise" });

/** A layer added linearly at every depth, so a domed biome's foot keeps it. */
export const Detail = declare<TerrainNoiseParams>({ kind: "detail", within: "noise" });
