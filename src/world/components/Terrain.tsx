import { declare } from "../content";
import type { TerrainParams } from "../types";

export interface TerrainProps extends Partial<TerrainParams> {}

/** The domain's global terrain knobs over world/defaults.ts. Domain-scoped: a region's base relief
 *  is its own <Noise>, a biome's is the <Noise> inside it. */
export const Terrain = declare<TerrainProps>({ kind: "terrain", within: "domain" });
