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
  });
  document.body.appendChild(el);
  return el;
}

export const initCursor = (): void => {
  getOrCreateCursor();
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
