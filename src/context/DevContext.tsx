import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { getSave, saveToDevice, useSave } from "../save/save";
import { DEV_TOGGLES } from "./constants";
import { DevContextType, DevToggleFlag, DevToggleFlags } from "./types";

const DevContext = createContext<DevContextType | undefined>(undefined);

interface DevContextProviderProps {
  children: ReactNode;
}

const ALL_TOGGLES_OFF = Object.fromEntries(DEV_TOGGLES.map(({ flag }) => [flag, false])) as DevToggleFlags;

/** Only the known flags, only booleans: a stale or hand-edited save can't inject anything else. */
const togglesFromSave = (saved: Partial<DevToggleFlags> | undefined): DevToggleFlags => {
  const toggles = { ...ALL_TOGGLES_OFF };
  for (const { flag } of DEV_TOGGLES) if (typeof saved?.[flag] === "boolean") toggles[flag] = saved[flag]!;
  return toggles;
};

const DEV_PARAM = "devmode";
/** With devmode off, this key turns it on (and flips nothing); with it on, it is its toggle's key. */
const DEVMODE_ON_KEY = "F1";

/** Boot: the URL decides devmode. `?devmode=true` turns it on; any other value, or no param, turns it off;
 *  the device save follows (save/: settings.devmode). From then on the setting writes the URL back. */
export const initDevmodeFromUrl = (): void => {
  const on = new URLSearchParams(window.location.search).get(DEV_PARAM) === "true";
  if ((getSave().settings?.devmode === true) !== on) saveToDevice({ settings: { ...getSave().settings, devmode: on } });
};

const setDevMode = (on: boolean): void => saveToDevice({ settings: { ...getSave().settings, devmode: on } });

/** The URL follows the setting (replaceState: the back trap's entries stay what they were). */
const writeDevmodeToUrl = (on: boolean): void => {
  const url = new URL(window.location.href);
  const synced = on ? url.searchParams.get(DEV_PARAM) === "true" : !url.searchParams.has(DEV_PARAM);
  if (synced) return;
  if (on) url.searchParams.set(DEV_PARAM, "true");
  else url.searchParams.delete(DEV_PARAM);
  window.history.replaceState(window.history.state, "", url);
};

export const DevContextProvider: React.FC<DevContextProviderProps> = ({ children }) => {
  const save = useSave();
  // Switched by the URL at boot (initDevmodeFromUrl) and on by DEVMODE_ON_KEY.
  const devMode = save.settings?.devmode === true;
  useEffect(() => writeDevmodeToUrl(devMode), [devMode]);
  // The checkboxes as last selected (device save), remembered while devmode is off.
  const selected = togglesFromSave(save.devToggles);
  const selectedKey = DEV_TOGGLES.map(({ flag }) => (selected[flag] ? "1" : "0")).join("");

  // Reads the save at call time: a render's `selected` is stale for a second click landing before the
  // re-render, and would overwrite the first.
  const setToggle = useCallback(
    (flag: DevToggleFlag, on: boolean) => saveToDevice({ devToggles: { ...togglesFromSave(getSave().devToggles), [flag]: on } }),
    [],
  );

  // Each toggle's function key flips it. Unmodified only, so Ctrl+F5 still hard-reloads.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (!devMode) {
        if (e.code !== DEVMODE_ON_KEY) return;
        e.preventDefault();
        setDevMode(true);
        return;
      }
      const toggle = DEV_TOGGLES.find(({ key }) => key === e.code);
      if (!toggle) return;
      e.preventDefault();
      setToggle(toggle.flag, !togglesFromSave(getSave().devToggles)[toggle.flag]);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [devMode, setToggle]);

  const value: DevContextType = useMemo(
    () => ({ ...(devMode ? selected : ALL_TOGGLES_OFF), devMode, setDevMode, setToggle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedKey IS selected's value
    [selectedKey, devMode, setToggle],
  );

  return <DevContext.Provider value={value}>{children}</DevContext.Provider>;
};

export const useDevContext = (): DevContextType => {
  const context = useContext(DevContext);

  if (context === undefined) {
    throw new Error("useDevContext must be used within a DevContextProvider");
  }

  return context;
};
