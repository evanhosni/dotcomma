import { declare } from "../content";
import { QUAYS } from "../../utils/workers/water/params";

/** QUAYS: the biome it is mounted in keeps its own river banks. The water code asks for this mount, never
 *  for the biome: no walls are cut there, no bed ends on a steep bank, no river merges into a lake beside
 *  it, and a river beside it at a lake is held up to the lake's level (its crisp edge gives the lake no
 *  weight there).
 *
 *  What KEEPS the banks is the biome's own height code, and today only the bespoke city has any (its quays
 *  and waterfront, the pipeline's one biome-id branch): there a river's surface also reads the biome at its
 *  plateau FLOOR, so no block stands under the water (vertexCompute.ts `waterTerrainAt`). Mounted on a
 *  biome with ordinary relief it only switches the river's bank rules off. */
export const Quays = declare({ kind: QUAYS, within: "biome" });
