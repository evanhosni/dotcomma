/**
 * THE tunnel chunk builder: one UndergroundChunk per 256u streaming chunk, style and biome — the caves'
 * (caveChunk.ts: surface nets, the entrance patch) or the sewers' (sewerChunk.ts: explicit faces, the
 * liquid, the caps) — or null when nothing of the style reaches it. The tunnel worker and the server
 * import it here. Three-free.
 */

import type { RectXZ } from "../../math/types";
import { buildCaveChunk } from "./caveChunk";
import { buildSewerChunk } from "./sewerChunk";
import type { TunnelStyle, UndergroundChunk } from "./types";

export { setRockTestEnabled } from "./caveChunk";

export const buildUndergroundChunk = (b: RectXZ, style: TunnelStyle, biomeId: number): UndergroundChunk | null =>
  style === "cave" ? buildCaveChunk(b, biomeId) : buildSewerChunk(b, biomeId);
