import { declare } from "../content";
import type { TerrainNoiseParams } from "../../generation/types";
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
