import { useEffect } from "react";
import { FONT, HUD_COLOR, HUD_Z_INDEX } from "../../../menus/overlay/styles";

/** "- click to enter -" over a full-page click trap until the pointer first locks; then the player walks
 *  up to the CRT (home/crt), and clicking it enters the overworld. */
const createEnterGate = (): HTMLDivElement => {
  const backdrop = document.createElement("div");
  // One under the HUD column, so the devmode panel stays clickable above it.
  backdrop.style.cssText = `position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:${HUD_Z_INDEX - 1};`;
  // drei's PointerLockControls listens on the DOCUMENT: a click reaching it would lock the pointer anywhere.
  backdrop.onclick = (e) => e.stopPropagation();

  const link = document.createElement("div");
  link.textContent = "- click to enter -";
  link.style.cssText = `font-family:${FONT};font-size:18px;letter-spacing:2px;color:#ffffff;cursor:pointer;user-select:none;`;
  link.onmouseenter = () => (link.style.color = HUD_COLOR);
  link.onmouseleave = () => (link.style.color = "#ffffff");
  link.onclick = (e) => {
    e.stopPropagation();
    // Never requestPointerLock ourselves: three-stdlib only flips isLocked when the locked element is the
    // one drei connected (events.connected), so locking any element we pick engages the browser lock with
    // dead mouse-look. The synthetic click runs drei's own document handler inside this click's user
    // activation.
    document.dispatchEvent(new MouseEvent("click"));
  };
  backdrop.appendChild(link);
  return backdrop;
};

/** The home page's HTML: the click-to-enter gate, gone once the pointer locks (and with the domain). */
export const HomeScreen = () => {
  useEffect(() => {
    const gate = createEnterGate();
    document.body.appendChild(gate);
    const onLockChange = () => {
      if (document.pointerLockElement) gate.remove();
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      gate.remove();
    };
  }, []);

  return null;
};
