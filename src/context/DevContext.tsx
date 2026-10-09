import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

/** Older links carried a bare `?devmode` (or `=`); anything but "false" counts as on. */
const readDevParam = (): boolean => {
  const value = new URLSearchParams(window.location.search).get(DEV_PARAM);
  return value !== null && value !== "false";
};

/** `?devmode=true` while on; off drops the param. Navigation (world/domains/navigation.ts) carries the
 *  query string through every path change. */
const writeDevParam = (devMode: boolean): void => {
  const url = new URL(window.location.href);
  if (devMode) url.searchParams.set(DEV_PARAM, "true");
  else url.searchParams.delete(DEV_PARAM);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
};

export const DevContextProvider: React.FC<DevContextProviderProps> = ({ children }) => {
  const [devMode, setDevMode] = useState(readDevParam);
  // The checkboxes as last selected (device save), remembered while devmode is off.
  const selected = togglesFromSave(useSave().devmode);
  const selectedKey = DEV_TOGGLES.map(({ flag }) => (selected[flag] ? "1" : "0")).join("");

  useEffect(() => writeDevParam(devMode), [devMode]);

  // Reads the save at call time: a render's `selected` is stale for a second click landing before the
  // re-render, and would overwrite the first.
  const setToggle = useCallback(
    (flag: DevToggleFlag, on: boolean) => saveToDevice({ devmode: { ...togglesFromSave(getSave().devmode), [flag]: on } }),
    [],
  );

  const toggleDevMode = useCallback(() => setDevMode((prev) => !prev), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "F1") {
        e.preventDefault();
        toggleDevMode();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleDevMode]);

  const value: DevContextType = useMemo(
    () => ({ ...(devMode ? selected : ALL_TOGGLES_OFF), devMode, toggleDevMode, setToggle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedKey IS selected's value
    [selectedKey, devMode, toggleDevMode, setToggle],
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
