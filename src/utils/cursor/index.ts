import { HUD_COLOR, HUD_Z_INDEX } from "../../menus/overlay/styles";

const CURSOR_ID = "game-cursor";

function getOrCreateCursor(): HTMLDivElement {
  let el = document.getElementById(CURSOR_ID) as HTMLDivElement | null;
  if (el) return el;

  el = document.createElement("div");
  el.id = CURSOR_ID;
  Object.assign(el.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "2px",
    height: "2px",
    borderRadius: "50%",
    backgroundColor: HUD_COLOR,
    pointerEvents: "none",
    zIndex: String(HUD_Z_INDEX),
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

let visibilityBound = false;

export const initCursor = (): void => {
  const el = getOrCreateCursor();

  // The crosshair only means anything while pointer lock is held.
  if (!visibilityBound) {
    visibilityBound = true;
    const sync = () => {
      el.style.display = document.pointerLockElement ? "block" : "none";
    };
    sync();
    document.addEventListener("pointerlockchange", sync);
  }
};

/** Something interactive under the crosshair (an actor, a door, a manhole). Held by claimHover while it is
 *  hovered; the object itself is the claim's key, so keep one per owner and update `distance` in place. */
export interface HoverTarget {
  /** Eye → hit: the NEAREST claim gets the mouse. */
  distance: number;
  /** Grows the crosshair while held. */
  growsCursor: boolean;
  /** Every mouse event while it is the nearest claim: click, contextmenu, pointerdown/up, dblclick, wheel. */
  onMouse: (e: MouseEvent) => void;
}

const MOUSE_EVENTS = ["click", "contextmenu", "pointerdown", "pointerup", "dblclick", "wheel"] as const;

const claims = new Set<HoverTarget>();
let mouseBound = false;

const nearestClaim = (): HoverTarget | null => {
  let best: HoverTarget | null = null;
  for (const claim of claims) if (!best || claim.distance < best.distance) best = claim;
  return best;
};

const syncCursorSize = (): void => {
  let grown = false;
  for (const claim of claims) grown ||= claim.growsCursor;
  const el = getOrCreateCursor();
  el.style.width = el.style.height = grown ? "6px" : "2px";
};

/** ONE set of window listeners for every hover target (an actor used to add six of its own). */
const bindMouse = (): void => {
  if (mouseBound) return;
  mouseBound = true;
  for (const type of MOUSE_EVENTS) window.addEventListener(type, (e) => nearestClaim()?.onMouse(e as MouseEvent));
};

export const claimHover = (target: HoverTarget): void => {
  if (claims.has(target)) return;
  claims.add(target);
  bindMouse();
  syncCursorSize();
};

/** Safe to call when not held (an unmount cleanup). */
export const releaseHover = (target: HoverTarget): void => {
  if (claims.delete(target)) syncCursorSize();
};
