export const PUBLIC_URL = process.env.PUBLIC_URL ?? "";

/** The one FIXED path: the landing page. Every other path is an in-map address
 *  (world/domains/overworld/address.ts). All paths are pushState-only (navigation.ts). */
export const HOME_PATH = "/";

/** Dispatched on window by the back-button trap. */
export const ESCAPE_POD_EVENT = "dotcomma:escape-pod";

/** Dispatched on window when a travel is requested INSIDE the overworld (navigation.ts → FastTravel). */
export const ADDRESS_TRAVEL_EVENT = "dotcomma:travel";
