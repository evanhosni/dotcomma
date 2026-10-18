import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { getSave, saveToDevice, useSave } from "../save/save";
import { DEV_TOGGLES } from "./constants";
import { DevContextType, DevToggleFlag, DevToggleFlags } from "./types";

const DevContext = createContext<DevContextType | undefined>(undefined);

interface DevContextProviderProps {
  children: ReactNode;
}

const DEV_PARAM = "devmode";

const ALL_TOGGLES_OFF = Object.fromEntries(DEV_TOGGLES.map(({ flag }) => [flag, false])) as DevToggleFlags;

/** Only the known flags, only booleans: a stale or hand-edited save can't inject anything else. */
const togglesFromSave = (saved: Partial<DevToggleFlags> | undefined): DevToggleFlags => {
  const toggles = { ...ALL_TOGGLES_OFF };
  for (const { flag } of DEV_TOGGLES) if (typeof saved?.[flag] === "boolean") toggles[flag] = saved[flag]!;
  return toggles;
};

/** Devmode is the `?devmode` param's PRESENCE (any value); navigation (world/domains/navigation.ts) carries
 *  the query string through every path change, so it holds for the page's lifetime. */
const readDevParam = (): boolean => new URLSearchParams(window.location.search).has(DEV_PARAM);

export const DevContextProvider: React.FC<DevContextProviderProps> = ({ children }) => {
  const devMode = useMemo(readDevParam, []);
  // The checkboxes as last selected (device save), remembered while devmode is off.
  const selected = togglesFromSave(useSave().devmode);
  const selectedKey = DEV_TOGGLES.map(({ flag }) => (selected[flag] ? "1" : "0")).join("");

  // Reads the save at call time: a render's `selected` is stale for a second click landing before the
  // re-render, and would overwrite the first.
  const setToggle = useCallback(
    (flag: DevToggleFlag, on: boolean) => saveToDevice({ devmode: { ...togglesFromSave(getSave().devmode), [flag]: on } }),
    [],
  );

  // Each toggle's function key flips it. Unmodified only, so Ctrl+F5 still hard-reloads.
  useEffect(() => {
    if (!devMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const toggle = DEV_TOGGLES.find(({ key }) => key === e.code);
      if (!toggle) return;
      e.preventDefault();
      setToggle(toggle.flag, !togglesFromSave(getSave().devmode)[toggle.flag]);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [devMode, setToggle]);

  const value: DevContextType = useMemo(
    () => ({ ...(devMode ? selected : ALL_TOGGLES_OFF), devMode, setToggle }),
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
