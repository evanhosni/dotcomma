import { useEffect } from "react";

/**
 * Pointer-lock gate — a real HTML overlay (not an in-canvas object): a
 * transparent full-page backdrop that swallows every click, so the canvas
 * CANNOT be clicked (or pointer-locked) until the player clicks the
 * "- click to enter -" text itself. The whole gate disappears for good the
 * first time pointer lock engages; after that (e.g. re-locking after Esc)
 * the canvas is clickable as normal.
 */
export const ClickToEnter = () => {
  useEffect(() => {
    // Full-page backdrop: invisible, but intercepts every pointer event
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "transparent",
      zIndex: "1000",
    });
    // Covering the canvas is not enough: drei's PointerLockControls listens
    // for clicks on DOCUMENT, so a click anywhere would bubble up and lock.
    // Kill the bubble at the backdrop — only the link's own handler locks.
    backdrop.onclick = (e) => e.stopPropagation();

    const link = document.createElement("div");
    link.textContent = "- click to enter -";
    Object.assign(link.style, {
      fontFamily: "'Kode Mono', 'Courier New', Courier, monospace",
      fontSize: "18px",
      letterSpacing: "2px",
      color: "#ffffff",
      cursor: "pointer",
      userSelect: "none",
    });
    link.onmouseenter = () => (link.style.color = "#00ff00");
    link.onmouseleave = () => (link.style.color = "#ffffff");
    link.onclick = (e) => {
      e.stopPropagation();
      // Don't requestPointerLock ourselves — drei's PointerLockControls is
      // connected to `events.connected || gl.domElement` (in practice R3F's
      // event-source element, NOT the canvas), and three-stdlib only flips
      // isLocked when pointerLockElement === ITS element. Locking any element
      // we pick here can therefore engage the browser lock while mouse-look
      // stays dead. Instead, fire the exact path a real canvas click takes:
      // drei's own click handler on `document` → controls.lock() on the
      // element it connected. The synthetic event runs inside this real
      // click's user activation, so the browser permits the lock.
      document.dispatchEvent(new MouseEvent("click"));
    };
    backdrop.appendChild(link);

    const onLockChange = () => {
      if (document.pointerLockElement) backdrop.style.display = "none";
    };
    document.addEventListener("pointerlockchange", onLockChange);
    document.body.appendChild(backdrop);

    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      backdrop.remove();
    };
  }, []);

  return null;
};
