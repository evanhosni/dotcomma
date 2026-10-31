import type { TerrainNoiseParams } from "../../utils/workers/types";

export const PUBLIC_URL = process.env.PUBLIC_URL ?? "";

/** The landing page. Every other path is an in-map address (world/domains/overworld/address.ts) or,
 *  failing that, the 404 domain. All paths are pushState-only (navigation.ts). */
export const HOME_PATH = "/";
/** Where every path that is not home and not an address lands. */
export const NOT_FOUND_PATH = "/404";

/** Dispatched on window by the back-button trap. */
export const ESCAPE_POD_EVENT = "dotcomma:escape-pod";

/** Zero relief: the base and road noise of a flat domain (home, 404). */
export const FLAT_NOISE: TerrainNoiseParams = { type: "perlin", octaves: 1, persistence: 1, lacunarity: 1, exponentiation: 1, height: 0, scale: 1000 };
