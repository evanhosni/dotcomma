import { HUD_COLOR, HUD_Z_INDEX } from "../../menus/overlay/constants";
import type { CursorLook, HoverTarget } from "./types";

const CURSOR_ID = "game-cursor";
const RETICLE_ID = "game-reticle";
/** The MAV Unit's reticle: four corner brackets around the screen centre (px). */
const RETICLE_WIDTH = 64;
const RETICLE_HEIGHT = 44;
const RETICLE_ARM = 12;
const RETICLE_STROKE = 3;

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

function getOrCreateReticle(): HTMLDivElement {
  let el = document.getElementById(RETICLE_ID) as HTMLDivElement | null;
  if (el) return el;

  el = document.createElement("div");
  el.id = RETICLE_ID;
  el.style.cssText = `position:fixed;top:50%;left:50%;width:${RETICLE_WIDTH}px;height:${RETICLE_HEIGHT}px;transform:translate(-50%,-50%);pointer-events:none;z-index:${HUD_Z_INDEX};display:none;`;
  const line = `${RETICLE_STROKE}px solid ${HUD_COLOR}`;
  for (const [v, h] of [["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const) {
    const corner = document.createElement("div");
    corner.style.cssText = `position:absolute;${v}:0;${h}:0;width:${RETICLE_ARM}px;height:${RETICLE_ARM}px;border-${v}:${line};border-${h}:${line};`;
    el.appendChild(corner);
  }
  document.body.appendChild(el);
  return el;
}

/** What the centre of the screen shows (setCursorLook), drawn only while pointer lock is held: the crosshair
 *  means nothing without it. */
let look: CursorLook = "dot";
let visibilityBound = false;

const syncCursorLook = (): void => {
  const locked = !!document.pointerLockElement;
  getOrCreateCursor().style.display = locked && look === "dot" ? "block" : "none";
  getOrCreateReticle().style.display = locked && look === "reticle" ? "block" : "none";
};

export const initCursor = (): void => {
  getOrCreateCursor();
  if (!visibilityBound) {
    visibilityBound = true;
    syncCursorLook();
    document.addEventListener("pointerlockchange", syncCursorLook);
  }
};

/** The beeble's dot, the MAV Unit's reticle, or nothing (the intro before its title has gone by). */
export const setCursorLook = (next: CursorLook): void => {
  if (next === look) return;
  look = next;
  syncCursorLook();
};

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
