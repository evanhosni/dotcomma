import { DomainId } from "./types";

const PUBLIC_URL = process.env.PUBLIC_URL ?? "";

/** FAKE paths — pushState only, nothing ever navigates (navigation.ts). */
export const DOMAIN_PATHS: Record<DomainId, string> = {
  home: `${PUBLIC_URL}/`,
  "glitch-city": `${PUBLIC_URL}/glitch-city`,
};

/** Dispatched on window by the back-button trap. */
export const ESCAPE_POD_EVENT = "dotcomma:escape-pod";
