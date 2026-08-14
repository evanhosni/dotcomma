import { DomainId } from "./types";

const PUBLIC_URL = process.env.PUBLIC_URL ?? "";

/** Fake URL path per domain — pushState only, nothing ever navigates
 *  (see navigation.ts). */
export const DOMAIN_PATHS: Record<DomainId, string> = {
  home: `${PUBLIC_URL}/`,
  "glitch-city": `${PUBLIC_URL}/glitch-city`,
};

/** Dispatched on window by the back-button trap. Hook the escape pod here. */
export const ESCAPE_POD_EVENT = "dotcomma:escape-pod";
