import { FONT, HUD_COLOR, HUD_Z_INDEX } from "./constants";

/** THE overlay look (CLAUDE.md → "UI / Overlay Styling"): green-on-black terminal panels. */

/** The overlay font at `px` pixels, for canvas text (`ctx.font`). */
export const fontOfSize = (px: number): string => `${px}px ${FONT}`;

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

/** Shared fixed container for bottom-left overlay panels. */
export function getOrCreateLeftColumn(): HTMLDivElement {
  let el = document.getElementById("overlay-left-column") as HTMLDivElement | null;
  if (!el) {
    const target = document.getElementById("dotcomma");
    el = document.createElement("div");
    el.id = "overlay-left-column";
    el.style.cssText =
      `position:fixed;bottom:12px;left:12px;z-index:${HUD_Z_INDEX};` +
      // Never taller than the screen: a panel that may grow (devmode) shrinks and scrolls inside it.
      "display:flex;flex-direction:column;gap:8px;pointer-events:none;max-height:calc(100vh - 24px);";
    target?.appendChild(el);
  }
  return el;
}
