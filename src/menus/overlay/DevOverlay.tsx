import { useEffect, useRef } from "react";
import { useDevContext } from "../../context/DevContext";
import { DEV_TOGGLES } from "../../context/constants";
import { getOrCreateLeftColumn } from "./overlayContainer";
import { VFX_GROUPS, VFX_KNOBS } from "../../vfx/tuning";
import { createHudCheckbox, createHudSlider, HUD_COLOR, paintHudCheckbox, PANEL_CSS } from "./styles";

export const DevOverlay = () => {
  const dev = useDevContext();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputsRef = useRef<HTMLInputElement[]>([]);
  const devRef = useRef(dev);
  devRef.current = dev;

  useEffect(() => {
    const column = getOrCreateLeftColumn();

    const panel = document.createElement("div");
    // The one panel of the column that shrinks (min-height:0) and scrolls when the open vfx list would push
    // the column past the screen; it takes the pointer so the wheel can scroll it.
    panel.style.cssText = "order:0;" + PANEL_CSS + `min-height:0;overflow-y:auto;pointer-events:auto;scrollbar-width:thin;scrollbar-color:${HUD_COLOR} transparent;`;
    // drei's PointerLockControls listens on the DOCUMENT: no click or scroll in the panel reaches the game.
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("wheel", (e) => e.stopPropagation());

    const title = document.createElement("div");
    title.style.cssText = "margin-bottom:4px;display:flex;justify-content:space-between;";
    title.textContent = "devmode";
    const close = document.createElement("span");
    close.textContent = "×";
    close.title = "close devmode";
    close.style.cssText = "cursor:pointer;pointer-events:auto;padding-left:12px;";
    close.onclick = (e) => {
      // drei's PointerLockControls listens on the DOCUMENT: this click must not lock the pointer.
      e.stopPropagation();
      devRef.current.setDevMode(false);
    };
    title.appendChild(close);
    panel.appendChild(title);

    inputsRef.current = DEV_TOGGLES.map(({ label, flag, key }) => {
      const checkbox = createHudCheckbox(`${label} [${key}]`, (checked) => devRef.current.setToggle(flag, checked));
      panel.appendChild(checkbox.row);
      return checkbox.input;
    });

    // "vfx ▸" expands one live slider per world effect (vfx/tuning.ts), sectioned by its group (the panel
    // scrolls), re-read on every open: a domain switch resets them to that domain's values.
    const vfxToggle = document.createElement("div");
    vfxToggle.style.cssText = "margin-top:4px;cursor:pointer;pointer-events:auto;user-select:none;";
    const vfx = document.createElement("div");
    vfx.style.cssText = "display:none;min-width:200px;";
    const sliders = VFX_GROUPS.flatMap((group) => {
      const knobs = VFX_KNOBS.filter((knob) => knob.group === group);
      if (knobs.length === 0) return [];
      const header = document.createElement("div");
      header.style.cssText = "margin-top:6px;opacity:0.6;text-transform:uppercase;letter-spacing:1px;";
      header.textContent = group;
      vfx.appendChild(header);
      return knobs.map((knob) => {
        const slider = createHudSlider(knob.label, knob, knob.get, knob.set);
        vfx.appendChild(slider.row);
        return slider;
      });
    });
    const setVfxOpen = (open: boolean): void => {
      vfx.style.display = open ? "block" : "none";
      vfxToggle.textContent = open ? "vfx ▾" : "vfx ▸";
      if (open) for (const slider of sliders) slider.refresh();
    };
    vfxToggle.onclick = (e) => {
      // drei's PointerLockControls listens on the DOCUMENT: this click must not lock the pointer.
      e.stopPropagation();
      setVfxOpen(vfx.style.display === "none");
    };
    setVfxOpen(false);
    panel.append(vfxToggle, vfx);

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

  // The function keys flip toggles outside the panel. One character per flag: re-syncs on any change.
  const flagsKey = DEV_TOGGLES.map(({ flag }) => (dev[flag] ? "1" : "0")).join("");
  useEffect(() => {
    inputsRef.current.forEach((input, i) => {
      const on = devRef.current[DEV_TOGGLES[i].flag];
      if (input.checked === on) return;
      input.checked = on;
      paintHudCheckbox(input);
    });
  }, [flagsKey]);

  return null;
};
