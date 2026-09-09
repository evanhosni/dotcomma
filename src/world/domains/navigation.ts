import { DOMAIN_PATHS, ESCAPE_POD_EVENT } from "./constants";
import { DomainId } from "./types";

/**
 * Client-side domain switching + back-button interception.
 *
 * Domains all live on ONE page and ONE persistent canvas (index.tsx swaps
 * the active domain inside <CustomCanvas>). URL paths are FAKE — pushState only, nothing ever navigates —
 * which is what makes the back button interceptable: every history entry
 * behind the current one is a same-document entry, so a back gesture (toolbar
 * button, Alt+Left, mouse button 4, swipe) fires `popstate` without unloading
 * anything. The handler restores the active domain's URL and fires the
 * escape-pod event — back can never leave or reload the game.
 *
 * Chrome's history-manipulation intervention (entries pushed WITHOUT a user
 * gesture are skipped by the browser back button) is why the trap arms on
 * real gestures: switchDomain runs inside the CRT click, and a sentinel is
 * pushed on the first pointer-lock of a session. Even a skipped entry only
 * lands on the page-load entry — still same-document, still popstate.
 */

/** Which domain a URL path (real load or fake pushState) boots into. */
export const domainIdFromPath = (path: string): DomainId => (path.includes("glitch-city") ? "glitch-city" : "home");

let currentDomain: DomainId = domainIdFromPath(window.location.pathname);
const domainListeners = new Set<(domain: DomainId) => void>();

const pushDomainEntry = () =>
  window.history.pushState({ dotcomma: true, domain: currentDomain }, "", DOMAIN_PATHS[currentDomain]);

export const getCurrentDomain = (): DomainId => currentDomain;

/** index.tsx subscribes to swap the mounted domain; the net connection
 *  subscribes to tell the server (presence is scoped per domain). */
export const onDomainChange = (fn: (domain: DomainId) => void): (() => void) => {
  domainListeners.add(fn);
  return () => {
    domainListeners.delete(fn);
  };
};

/** Swap the active domain in place (CRT monitor click). Must be called from a
 *  user gesture so the pushed entry isn't back-button-skippable. The canvas
 *  (the pointer-locked element) persists across the swap, so the lock is
 *  simply kept — the old per-domain canvas needed a re-lock dance here. */
export const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  pushDomainEntry();
  domainListeners.forEach((fn) => fn(id));
};

export const initDomainNavigation = () => {
  // Back → escape pod: undo the URL change immediately; the domain never
  // switches on back.
  window.addEventListener("popstate", () => {
    pushDomainEntry();
    console.log("rescue");
    window.dispatchEvent(new Event(ESCAPE_POD_EVENT));
  });

  // Direct loads (typed URL) have no same-document entry behind them until
  // something is pushed — arm a sentinel on the first pointer lock, which is
  // always downstream of a real click (gesture ⇒ not skippable).
  document.addEventListener("pointerlockchange", () => {
    const state = window.history.state as { dotcomma?: boolean } | null;
    if (document.pointerLockElement && !state?.dotcomma) pushDomainEntry();
  });
};
