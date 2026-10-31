import { ESCAPE_POD_EVENT, HOME_PATH, NOT_FOUND_PATH, PUBLIC_URL } from "./constants";
import { type Address, isKnownAddress, parseAddressPath } from "./overworld/address";
import type { SerializedRegion } from "../../utils/workers/types";
import { DomainId } from "./types";

/**
 * Client-side navigation with FAKE (pushState-only) URL paths. Nothing ever
 * navigates, so every history entry behind the player is same-document and a
 * back gesture can only fire `popstate` — which becomes the escape pod. Entries
 * pushed without a user gesture are back-button-skippable in Chrome, so the trap
 * arms only from real gestures (the home page's enter click, first pointer lock).
 *
 * "/" is the home domain. A path that is an ADDRESS (overworld/address.ts) boots
 * the overworld there, and the address bar follows the player as they walk
 * (replaceAddressPath). Every other path is replaced by "/404", the 404 domain.
 */

const stripBase = (pathname: string): string => {
  const p = PUBLIC_URL && pathname.startsWith(PUBLIC_URL) ? pathname.slice(PUBLIC_URL.length) : pathname;
  return p || HOME_PATH;
};

// Set by initDomainNavigation(), the browser's entry point: the server bundles this module with the
// content trees and has no window.
let currentPath = HOME_PATH;
let currentDomain: DomainId = "home";
/** The address the overworld should travel to on mount (from the boot URL); null = the origin. */
let pendingAddress: Address | null = null;

const domainListeners = new Set<(domain: DomainId) => void>();

const historyState = () => ({ dotcomma: true, domain: currentDomain });
/** The path is ours; the query string rides along untouched. */
const urlOf = (path: string): string => PUBLIC_URL + path + window.location.search;
const pushEntry = () => window.history.pushState(historyState(), "", urlOf(currentPath));

export const getCurrentDomain = (): DomainId => currentDomain;

export const onDomainChange = (fn: (domain: DomainId) => void): (() => void) => {
  domainListeners.add(fn);
  return () => {
    domainListeners.delete(fn);
  };
};

/** Consumed once by the overworld's FastTravel on mount. */
export const takePendingAddress = (): Address | null => {
  const address = pendingAddress;
  pendingAddress = null;
  return address;
};

/** Must be called from a user gesture so the pushed entry isn't back-button-skippable. */
const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  if (id === "home") currentPath = HOME_PATH;
  if (id === "404") currentPath = NOT_FOUND_PATH;
  pushEntry();
  domainListeners.forEach((fn) => fn(id));
};

/** The home page's way in, from its click: the overworld, at the biome cell the world origin sits in. */
export const enterOverworld = () => {
  pendingAddress = null;
  switchDomain("overworld");
};

/** The address bar follows the player. replaceState, so the back trap's entry stays what it was. */
export const replaceAddressPath = (path: string) => {
  if (currentDomain !== "overworld" || path === currentPath) return;
  currentPath = path;
  window.history.replaceState(window.history.state ?? historyState(), "", urlOf(path));
};

/** `overworldRegions` name the addresses that exist; passed in because the content trees import this
 *  module (the home page enters the overworld through it), and importing them back is a module cycle. */
export const initDomainNavigation = (overworldRegions: readonly SerializedRegion[]) => {
  const bootPath = stripBase(window.location.pathname);
  const address = bootPath === HOME_PATH ? null : parseAddressPath(bootPath);
  pendingAddress = address && isKnownAddress(address, overworldRegions) ? address : null;
  currentDomain = bootPath === HOME_PATH ? "home" : pendingAddress ? "overworld" : "404";
  currentPath = currentDomain === "404" ? NOT_FOUND_PATH : bootPath;
  if (currentPath !== bootPath) window.history.replaceState(window.history.state, "", urlOf(currentPath));

  // Back → escape pod; the URL is restored and the domain never switches.
  window.addEventListener("popstate", () => {
    pushEntry();
    window.dispatchEvent(new Event(ESCAPE_POD_EVENT));
  });

  // A direct load has no same-document entry behind it: arm a sentinel on the
  // first pointer lock (always downstream of a real click).
  document.addEventListener("pointerlockchange", () => {
    const state = window.history.state as { dotcomma?: boolean } | null;
    if (document.pointerLockElement && !state?.dotcomma) pushEntry();
  });
};
