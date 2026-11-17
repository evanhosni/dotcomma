import React from "react";
import { createContext, ReactNode, useCallback, useEffect, useMemo } from "react";
import { getSave, saveToDevice, useSave } from "../save/store";
import { DEV_TOGGLES } from "./constants";
import { DevContextType, DevToggleFlag } from "./types";
import { writeDevmodeToUrl, togglesFromSave, setDevMode, ALL_TOGGLES_OFF } from "./utils";

export const DevContext = createContext<DevContextType | undefined>(undefined);

interface DevContextProviderProps {
  children: ReactNode;
}
/** With devmode off, this key turns it on (and flips nothing); with it on, it is its toggle's key. */
const DEVMODE_ON_KEY = "F1";

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
