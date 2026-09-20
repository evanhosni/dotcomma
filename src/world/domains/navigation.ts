import { DOMAIN_PATHS, ESCAPE_POD_EVENT } from "./constants";
import { DomainId } from "./types";

/**
 * Client-side domain switching with FAKE (pushState-only) URL paths. Nothing
 * ever navigates, so every history entry behind the player is same-document
 * and a back gesture can only fire `popstate` — which becomes the escape pod.
 * Entries pushed without a user gesture are back-button-skippable in Chrome,
 * so the trap arms only from real gestures (CRT click, first pointer lock).
 */

export const domainIdFromPath = (path: string): DomainId => (path.includes("glitch-city") ? "glitch-city" : "home");

let currentDomain: DomainId = domainIdFromPath(window.location.pathname);
const domainListeners = new Set<(domain: DomainId) => void>();

const pushDomainEntry = () =>
  window.history.pushState({ dotcomma: true, domain: currentDomain }, "", DOMAIN_PATHS[currentDomain]);

export const getCurrentDomain = (): DomainId => currentDomain;

export const onDomainChange = (fn: (domain: DomainId) => void): (() => void) => {
  domainListeners.add(fn);
  return () => {
    domainListeners.delete(fn);
  };
};

/** Must be called from a user gesture so the pushed entry isn't back-button-skippable. */
export const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  pushDomainEntry();
  domainListeners.forEach((fn) => fn(id));
};

export const initDomainNavigation = () => {
  // Back → escape pod; the URL is restored and the domain never switches.
  window.addEventListener("popstate", () => {
    pushDomainEntry();
    console.log("rescue");
    window.dispatchEvent(new Event(ESCAPE_POD_EVENT));
  });

  // A direct load has no same-document entry behind it: arm a sentinel on the
  // first pointer lock (always downstream of a real click).
  document.addEventListener("pointerlockchange", () => {
    const state = window.history.state as { dotcomma?: boolean } | null;
    if (document.pointerLockElement && !state?.dotcomma) pushDomainEntry();
  });
};
