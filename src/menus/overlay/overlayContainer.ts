/** Shared fixed container for bottom-left overlay panels. */
export function getOrCreateLeftColumn(): HTMLDivElement {
  let el = document.getElementById("overlay-left-column") as HTMLDivElement | null;
  if (!el) {
    const target = document.getElementById("dotcomma");
    el = document.createElement("div");
    el.id = "overlay-left-column";
    el.style.cssText =
      "position:fixed;bottom:12px;left:12px;z-index:1000;" +
      "display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    target?.appendChild(el);
  }
  return el;
}
