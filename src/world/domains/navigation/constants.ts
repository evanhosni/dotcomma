export const PUBLIC_URL = process.env.PUBLIC_URL ?? "";

/** The bare site: the overworld at the origin's cell, its intro on the title screen. Every other path is an
 *  in-map address (world/domains/overworld/address/index.ts) or, failing that, the 404 domain. All paths
 *  are pushState-only (world/domains/navigation/index.ts). */
export const ROOT_PATH = "/";
/** Where every path that is not the root and not an address lands. */
export const NOT_FOUND_PATH = "/404";

/** Dispatched on window by the back-button trap. */
export const ESCAPE_POD_EVENT = "dotcomma:escape-pod";
