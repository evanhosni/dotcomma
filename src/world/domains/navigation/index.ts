import { ESCAPE_POD_EVENT, NOT_FOUND_PATH, PUBLIC_URL, ROOT_PATH } from "./constants";
import { type Address } from "../overworld/address/types";
import { isKnownAddress, parseAddressPath } from "../overworld/address";
import type { SerializedRegion } from "../../../generation/types";
import { DomainId } from "../types";

/**
 * Client-side navigation with FAKE (pushState-only) URL paths. Nothing ever
 * navigates, so every history entry behind the player is same-document and a
 * back gesture can only fire `popstate` — which becomes the escape pod. Entries
 * pushed without a user gesture are back-button-skippable in Chrome, so the trap
 * arms only from real gestures (the first pointer lock: the intro's enter click).
 *
 * "/" and every path that is an ADDRESS (world/domains/overworld/address/index.ts) boot the overworld:
 * the bare site at the origin's cell, an address at its place. The address bar is HELD on the boot path
 * until the intro lets it go (holdAddressBar), then follows the player as they walk (replaceAddressPath).
 * Every other path is replaced by "/404", the 404 domain.
 */

const stripBase = (pathname: string): string => {
  const p = PUBLIC_URL && pathname.startsWith(PUBLIC_URL) ? pathname.slice(PUBLIC_URL.length) : pathname;
  return p || ROOT_PATH;
};

// Set by initDomainNavigation(), the browser's entry point: the server bundles this module with the
// content trees and has no window.
let currentPath = ROOT_PATH;
let currentDomain: DomainId = "overworld";
/** The address the overworld should travel to on mount (from the boot URL); null = the origin. */
let pendingAddress: Address | null = null;
/** While held, replaceAddressPath leaves the address bar alone (the intro's title screen: the bare site). */
let addressHeld = false;

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

/** Consumed once by the overworld's intro on mount. */
export const takePendingAddress = (): Address | null => {
  const address = pendingAddress;
  pendingAddress = null;
  return address;
};

/** Switches the domain inside the one canvas (index.tsx). Call from a user gesture, so the pushed entry
 *  isn't back-button-skippable. No caller today: every path boots its domain directly. */
export const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  if (id === "404") currentPath = NOT_FOUND_PATH;
  pushEntry();
  domainListeners.forEach((fn) => fn(id));
};

export const holdAddressBar = (held: boolean): void => {
  addressHeld = held;
};

/** The address bar follows the player. replaceState, so the back trap's entry stays what it was. */
export const replaceAddressPath = (path: string) => {
  if (!addressHeld) flashAddressPath(path);
};

/** Shows a path even while the bar is held (the intro's scan flicking through addresses). */
export const flashAddressPath = (path: string) => {
  if (currentDomain !== "overworld" || path === currentPath) return;
  currentPath = path;
  window.history.replaceState(window.history.state ?? historyState(), "", urlOf(path));
};

/** `overworldRegions` name the addresses that exist; passed in because the content trees import this
 *  module (the overworld's address glue), and importing them back is a module cycle. */
export const initDomainNavigation = (overworldRegions: readonly SerializedRegion[]) => {
  const bootPath = stripBase(window.location.pathname);
  const address = bootPath === ROOT_PATH ? null : parseAddressPath(bootPath);
  pendingAddress = address && isKnownAddress(address, overworldRegions) ? address : null;
  currentDomain = bootPath === ROOT_PATH || pendingAddress ? "overworld" : "404";
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
