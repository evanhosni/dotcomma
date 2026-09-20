import { useEffect } from "react";

/** HTML pointer-lock gate: a full-page backdrop swallows every click until the
 *  "- click to enter -" text is clicked; gone for good once lock first engages. */
export const ClickToEnter = () => {
  useEffect(() => {
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
    // drei's PointerLockControls listens on DOCUMENT — covering the canvas isn't enough.
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
      // Never requestPointerLock ourselves: three-stdlib only flips isLocked
      // when the locked element is the one drei connected (events.connected),
      // so locking any element we pick engages the browser lock with dead
      // mouse-look. The synthetic click runs drei's own document handler
      // inside this click's user activation.
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
