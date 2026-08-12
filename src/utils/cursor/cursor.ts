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
    backgroundColor: "#0f0",
    pointerEvents: "none",
    zIndex: "1000",
    // Hidden until the canvas is focused (pointer lock) — see initCursor.
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

let visibilityBound = false;

export const initCursor = (): void => {
  const el = getOrCreateCursor();

  // The crosshair only means anything while mouse-look is engaged — hide it
  // whenever the canvas doesn't hold pointer lock (menus, before clicking in).
  if (!visibilityBound) {
    visibilityBound = true;
    const sync = () => {
      el.style.display = document.pointerLockElement ? "block" : "none";
    };
    sync();
    document.addEventListener("pointerlockchange", sync);
  }
};

export const showCursor = (): void => {
  const el = getOrCreateCursor();
  el.style.width = "6px";
  el.style.height = "6px";
};

export const hideCursor = (): void => {
  const el = getOrCreateCursor();
  el.style.width = "2px";
  el.style.height = "2px";
};
