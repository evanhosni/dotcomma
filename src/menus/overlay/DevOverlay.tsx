import { useEffect, useRef } from "react";
import { useDevContext } from "../../context/DevContext";
import { DevContextType } from "../../context/types";
import { getOrCreateLeftColumn } from "./overlayContainer";
import { HUD_COLOR, PANEL_CSS } from "./styles";

type DevFlag = { [K in keyof DevContextType]: DevContextType[K] extends boolean ? K : never }[keyof DevContextType];

interface DevToggle {
  label: string;
  flag: DevFlag;
  set: (dev: DevContextType, on: boolean) => void;
}

/** One checkbox per entry, in panel order. */
const TOGGLES: readonly DevToggle[] = [
  { label: "noclip", flag: "noclip", set: (dev, on) => dev.setNoclip(on) },
  { label: "physics debug", flag: "physicsDebug", set: (dev, on) => dev.setPhysicsDebug(on) },
];

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

    inputsRef.current = TOGGLES.map(({ label, set }) => {
      const checkbox = createCheckbox(label, (checked) => set(devRef.current, checked));
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

  // Devmode turning off resets the toggles externally.
  const flags = TOGGLES.map(({ flag }) => dev[flag]);
  useEffect(() => {
    inputsRef.current.forEach((input, i) => {
      if (input.checked === flags[i]) return;
      input.checked = flags[i];
      paintCheckbox(input);
    });
  }, flags); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};
