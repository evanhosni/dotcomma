import { useEffect, useRef } from "react";
import { useDevMode } from "../../context/DevContext";
import { getOrCreateLeftColumn } from "./overlayContainer";

const FONT = "'Kode Mono','Courier New',Courier,monospace";

function createCheckbox(
  label: string,
  initial: boolean,
  onChange: (checked: boolean) => void,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0;pointer-events:auto;";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = initial;
  input.style.cssText =
    "appearance:none;width:12px;height:12px;border:1px solid #0f0;border-radius:2px;" +
    "background:transparent;cursor:pointer;position:relative;flex-shrink:0;";

  // Checked state styling via change event
  const updateStyle = () => {
    input.style.background = input.checked ? "#0f0" : "transparent";
  };
  updateStyle();

  input.addEventListener("change", () => {
    updateStyle();
    onChange(input.checked);
    input.blur();
  });

  const span = document.createElement("span");
  span.textContent = label;

  row.appendChild(input);
  row.appendChild(span);
  return { row, input };
}

export const DevOverlay = () => {
  const { devMode, noclip, physicsDebug, setNoclip, setPhysicsDebug } = useDevMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const noclipInputRef = useRef<HTMLInputElement | null>(null);
  const physicsInputRef = useRef<HTMLInputElement | null>(null);

  // Build DOM once
  useEffect(() => {
    const column = getOrCreateLeftColumn();

    const panel = document.createElement("div");
    panel.style.cssText =
      `order:0;background:rgba(0,0,0,0.6);color:#0f0;` +
      `font-family:${FONT};font-size:12px;line-height:1.5;` +
      `padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre;`;

    const title = document.createElement("div");
    title.textContent = "devmode";
    title.style.cssText = "margin-bottom:4px;";
    panel.appendChild(title);

    const noclipCb = createCheckbox("noclip", false, setNoclip);
    panel.appendChild(noclipCb.row);
    noclipInputRef.current = noclipCb.input;

    const physicsCb = createCheckbox("physics debug", false, setPhysicsDebug);
    panel.appendChild(physicsCb.row);
    physicsInputRef.current = physicsCb.input;

    containerRef.current = panel;
    column.appendChild(panel);

    return () => {
      panel.remove();
      containerRef.current = null;
    };
  }, []);

  // Sync visibility with devMode
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.display = devMode ? "block" : "none";
    }
  }, [devMode]);

  // Sync checkbox state when toggled externally (e.g. devmode turned off resets them)
  useEffect(() => {
    if (noclipInputRef.current && noclipInputRef.current.checked !== noclip) {
      noclipInputRef.current.checked = noclip;
      noclipInputRef.current.style.background = noclip ? "#0f0" : "transparent";
    }
  }, [noclip]);

  useEffect(() => {
    if (physicsInputRef.current && physicsInputRef.current.checked !== physicsDebug) {
      physicsInputRef.current.checked = physicsDebug;
      physicsInputRef.current.style.background = physicsDebug ? "#0f0" : "transparent";
    }
  }, [physicsDebug]);

  return null;
};
