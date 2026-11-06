import { HUD_Z_INDEX } from "./styles";

/** Shared fixed container for bottom-left overlay panels. */
export function getOrCreateLeftColumn(): HTMLDivElement {
  let el = document.getElementById("overlay-left-column") as HTMLDivElement | null;
  if (!el) {
    const target = document.getElementById("dotcomma");
    el = document.createElement("div");
    el.id = "overlay-left-column";
    el.style.cssText =
      `position:fixed;bottom:12px;left:12px;z-index:${HUD_Z_INDEX};` +
      // Never taller than the screen: a panel that may grow (devmode) shrinks and scrolls inside it.
      "display:flex;flex-direction:column;gap:8px;pointer-events:none;max-height:calc(100vh - 24px);";
    target?.appendChild(el);
  }
  return el;
}
