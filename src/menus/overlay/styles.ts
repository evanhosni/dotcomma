import type React from "react";

/** THE overlay look (CLAUDE.md → "UI / Overlay Styling"): green-on-black terminal panels. */

export const FONT = "'Kode Mono', 'Courier New', Courier, monospace";
export const HUD_COLOR = "#0f0";
export const PANEL_BACKGROUND = "rgba(0,0,0,0.6)";
export const HUD_Z_INDEX = 1000;

/** The overlay font at `px` pixels, for canvas text (`ctx.font`). */
export const fontOfSize = (px: number): string => `${px}px ${FONT}`;

/** A HUD panel for React `style` props. */
export const PANEL_STYLE: React.CSSProperties = {
  pointerEvents: "none",
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.5,
  color: HUD_COLOR,
  background: PANEL_BACKGROUND,
  borderRadius: 4,
  padding: "8px 12px",
  whiteSpace: "pre",
};

/** The overlay font as a cssText fragment, for imperatively built DOM. */
export const FONT_CSS = `font-family:${FONT};font-size:12px;line-height:1.5;`;

/** PANEL_STYLE as a cssText string, for imperatively built DOM. */
export const PANEL_CSS =
  `background:${PANEL_BACKGROUND};color:${HUD_COLOR};${FONT_CSS}` +
  "padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre;";

export const paintHudCheckbox = (input: HTMLInputElement): void => {
  input.style.background = input.checked ? HUD_COLOR : "transparent";
};

/** THE overlay checkbox (the devmode toggles): a HUD-green square, filled when
 *  checked, in a clickable label row. Set `input.checked` from outside with paintHudCheckbox after. */
export function createHudCheckbox(
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
  paintHudCheckbox(input);

  input.addEventListener("change", () => {
    paintHudCheckbox(input);
    onChange(input.checked);
    input.blur();
  });

  const span = document.createElement("span");
  span.textContent = label;

  row.appendChild(input);
  row.appendChild(span);
  return { row, input };
}

/** THE overlay slider: a label, its live value and a HUD-green range under them. `refresh` re-reads the value
 *  (set from outside). The value shows with as many decimals as `step` has. */
export function createHudSlider(
  label: string,
  { min, max, step }: { min: number; max: number; step: number },
  get: () => number,
  onInput: (value: number) => void,
): { row: HTMLDivElement; refresh: () => void } {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const row = document.createElement("div");
  row.style.cssText = "padding:2px 0;pointer-events:auto;";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;gap:12px;";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("span");
  head.append(name, value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.cssText = `display:block;width:100%;margin:2px 0 0;accent-color:${HUD_COLOR};cursor:pointer;`;

  const refresh = (): void => {
    const v = get();
    input.value = String(v);
    value.textContent = v.toFixed(decimals);
  };
  input.addEventListener("input", () => {
    onInput(Number(input.value));
    value.textContent = Number(input.value).toFixed(decimals);
  });
  refresh();
  row.append(head, input);
  return { row, refresh };
}
