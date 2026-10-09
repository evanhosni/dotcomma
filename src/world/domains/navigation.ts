import { ADDRESS_TRAVEL_EVENT, ESCAPE_POD_EVENT, HOME_PATH, PUBLIC_URL } from "./constants";
import { type Address, parseAddressPath } from "./overworld/address";
import { DomainId } from "./types";

/**
 * Client-side navigation with FAKE (pushState-only) URL paths. Nothing ever
 * navigates, so every history entry behind the player is same-document and a
 * back gesture can only fire `popstate` — which becomes the escape pod. Entries
 * pushed without a user gesture are back-button-skippable in Chrome, so the trap
 * arms only from real gestures (CRT click, first pointer lock).
 *
 * "/" is the home domain. EVERY other path is an ADDRESS inside the overworld
 * (overworld/address.ts): entering one from home is a domain switch, entering one
 * from inside the overworld is a teleport (ADDRESS_TRAVEL_EVENT → FastTravel), and
 * the address bar follows the player as they walk (replaceAddressPath).
 */

const stripBase = (pathname: string): string => {
  const p = PUBLIC_URL && pathname.startsWith(PUBLIC_URL) ? pathname.slice(PUBLIC_URL.length) : pathname;
  return p || HOME_PATH;
};

const domainIdFromPath = (path: string): DomainId => (parseAddressPath(stripBase(path)) ? "overworld" : "home");

let currentPath = stripBase(window.location.pathname);
let currentDomain: DomainId = domainIdFromPath(currentPath);
/** The address the overworld should travel to next (from the boot URL or a navigateToAddress). */
let pendingAddress: Address | null = parseAddressPath(currentPath);
if (currentDomain === "home") currentPath = HOME_PATH;

const domainListeners = new Set<(domain: DomainId) => void>();

const historyState = () => ({ dotcomma: true, domain: currentDomain });
/** The path is ours; the query string (`?devmode=true`, context/DevContext.tsx) rides along untouched. */
const urlOf = (path: string): string => PUBLIC_URL + path + window.location.search;
const pushEntry = () => window.history.pushState(historyState(), "", urlOf(currentPath));

export const getCurrentDomain = (): DomainId => currentDomain;

export const onDomainChange = (fn: (domain: DomainId) => void): (() => void) => {
  domainListeners.add(fn);
  return () => {
    domainListeners.delete(fn);
  };
};

/** Consumed once by the overworld's FastTravel on mount / on ADDRESS_TRAVEL_EVENT. */
export const takePendingAddress = (): Address | null => {
  const address = pendingAddress;
  pendingAddress = null;
  return address;
};

/** Must be called from a user gesture so the pushed entry isn't back-button-skippable. */
export const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  if (id === "home") currentPath = HOME_PATH;
  pushEntry();
  domainListeners.forEach((fn) => fn(id));
};

/** Travel to an address path ("/city", "/city/amber-crooked-lantern", "/amber-crooked-lantern")
 *  from a user gesture: a domain switch into the overworld, or a teleport inside it. */
export const navigateToAddress = (path: string) => {
  const address = parseAddressPath(stripBase(path));
  if (!address) return;
  pendingAddress = address;
  currentPath = stripBase(path);
  if (currentDomain !== "overworld") {
    switchDomain("overworld");
    return;
  }
  pushEntry();
  window.dispatchEvent(new Event(ADDRESS_TRAVEL_EVENT));
};

/** The address bar follows the player. replaceState, so the back trap's entry stays what it was. */
export const replaceAddressPath = (path: string) => {
  if (currentDomain !== "overworld" || path === currentPath) return;
  currentPath = path;
  window.history.replaceState(window.history.state ?? historyState(), "", urlOf(path));
};

export const initDomainNavigation = () => {
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
