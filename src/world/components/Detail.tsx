import { declare } from "../content";
import type { TerrainNoiseParams } from "../../generation/types";

/** A layer added linearly at every depth, so a domed biome's foot keeps it. */
export const Detail = declare<TerrainNoiseParams>({ kind: "detail", within: "noise" });
