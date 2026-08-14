import { DOMAIN_PATHS, ESCAPE_POD_EVENT } from "./constants";
import { DomainId } from "./types";

/**
 * Client-side domain switching + back-button interception.
 *
 * Domains all live on ONE page (index.tsx renders one <CustomCanvas> for the
 * active domain). URL paths are FAKE — pushState only, nothing ever navigates —
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
let domainListener: ((domain: DomainId) => void) | null = null;

const pushDomainEntry = () =>
  window.history.pushState({ dotcomma: true, domain: currentDomain }, "", DOMAIN_PATHS[currentDomain]);

export const getCurrentDomain = (): DomainId => currentDomain;

/** index.tsx subscribes to remount the canvas; one listener is enough. */
export const onDomainChange = (fn: (domain: DomainId) => void): (() => void) => {
  domainListener = fn;
  return () => {
    if (domainListener === fn) domainListener = null;
  };
};

/** Swap the active domain in place (CRT monitor click). Must be called from a
 *  user gesture so the pushed entry isn't back-button-skippable (and so the
 *  pointer relock below still has transient activation). */
export const switchDomain = (id: DomainId) => {
  if (id === currentDomain) return;
  currentDomain = id;
  pushDomainEntry();
  // The canvas (the locked element) is about to unmount, which force-releases
  // pointer lock — remember it was held so the incoming domain re-engages it,
  // and CSS-hide the native cursor so it doesn't flash during the gap.
  relockPending = !!document.pointerLockElement;
  if (relockPending) setNativeCursorHidden(true);
  domainListener?.(id);
};

const setNativeCursorHidden = (hidden: boolean) => {
  document.documentElement.style.cursor = hidden ? "none" : "";
};

let relockPending = false;

/** Called by the incoming domain's Player on mount, passing drei's OWN
 *  `controls.lock` — that requests the lock on exactly the element the new
 *  controls are connected to, so three-stdlib's isLocked flips and mouse-look
 *  works. (A synthetic document click was tried first and REJECTED: it also
 *  reaches the OUTGOING canvas's still-attached controls handler, whose
 *  detached element makes requestPointerLock throw.) Retried briefly: the
 *  CRT click's transient activation (~5s) keeps the re-request legal. */
export const relockPointerAfterSwitch = (lock: () => void) => {
  if (!relockPending) return;
  relockPending = false;
  const deadline = performance.now() + 3000;
  const tryLock = () => {
    // Done: either the lock landed (cursor is captured anyway) or the
    // activation window closed (give the user their cursor back).
    if (document.pointerLockElement || performance.now() > deadline) {
      setNativeCursorHidden(false);
      return;
    }
    try {
      lock();
    } catch {
      // Controls not connected yet — the retry below covers it.
    }
    setTimeout(tryLock, 100);
  };
  tryLock();
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
