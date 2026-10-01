import { useEffect, useRef } from "react";
import { useDevContext } from "../../context/DevContext";
import { DEV_TOGGLES } from "../../context/constants";
import { getOrCreateLeftColumn } from "./overlayContainer";
import { HUD_COLOR, PANEL_CSS } from "./styles";

const paintCheckbox = (input: HTMLInputElement): void => {
  input.style.background = input.checked ? HUD_COLOR : "transparent";
};

function createCheckbox(
  label: string,
  onChange: (checked: boolean) => void,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0;pointer-events:auto;";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = false;
  input.style.cssText =
    `appearance:none;width:12px;height:12px;border:1px solid ${HUD_COLOR};border-radius:2px;` +
    "background:transparent;cursor:pointer;position:relative;flex-shrink:0;";
  paintCheckbox(input);

  input.addEventListener("change", () => {
    paintCheckbox(input);
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
  const dev = useDevContext();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputsRef = useRef<HTMLInputElement[]>([]);
  const devRef = useRef(dev);
  devRef.current = dev;

  useEffect(() => {
    const column = getOrCreateLeftColumn();

    const panel = document.createElement("div");
    panel.style.cssText = "order:0;" + PANEL_CSS;

    const title = document.createElement("div");
    title.textContent = "devmode";
    title.style.cssText = "margin-bottom:4px;";
    panel.appendChild(title);

    inputsRef.current = DEV_TOGGLES.map(({ label, flag }) => {
      const checkbox = createCheckbox(label, (checked) => devRef.current.setToggle(flag, checked));
      panel.appendChild(checkbox.row);
      return checkbox.input;
    });

    panelRef.current = panel;
    column.appendChild(panel);

    return () => {
      panel.remove();
      panelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (panelRef.current) panelRef.current.style.display = dev.devMode ? "block" : "none";
  }, [dev.devMode]);

  // Devmode turning off resets the toggles externally. One character per flag: re-syncs on any change.
  const flagsKey = DEV_TOGGLES.map(({ flag }) => (dev[flag] ? "1" : "0")).join("");
  useEffect(() => {
    inputsRef.current.forEach((input, i) => {
      const on = devRef.current[DEV_TOGGLES[i].flag];
      if (input.checked === on) return;
      input.checked = on;
      paintCheckbox(input);
    });
  }, [flagsKey]);

  return null;
};
