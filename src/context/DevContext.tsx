import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEV_TOGGLES } from "./constants";
import { DevContextType, DevToggleFlag, DevToggleFlags } from "./types";

const DevContext = createContext<DevContextType | undefined>(undefined);

interface DevContextProviderProps {
  children: ReactNode;
}

const ALL_TOGGLES_OFF = Object.fromEntries(DEV_TOGGLES.map(({ flag }) => [flag, false])) as DevToggleFlags;

function readDevParam(): boolean {
  return new URLSearchParams(window.location.search).has("devmode");
}

function writeDevParam(devMode: boolean) {
  const url = new URL(window.location.href);
  if (devMode) url.searchParams.set("devmode", "");
  else url.searchParams.delete("devmode");
  window.history.replaceState(null, "", url.toString());
}

export const DevContextProvider: React.FC<DevContextProviderProps> = ({ children }) => {
  const [devMode, setDevMode] = useState(readDevParam);
  const [toggles, setToggles] = useState<DevToggleFlags>(ALL_TOGGLES_OFF);

  const setToggle = useCallback((flag: DevToggleFlag, on: boolean) => {
    setToggles((prev) => (prev[flag] === on ? prev : { ...prev, [flag]: on }));
  }, []);

  const toggleDevMode = useCallback(() => {
    setDevMode((prev) => {
      const next = !prev;
      writeDevParam(next);
      if (!next) setToggles(ALL_TOGGLES_OFF);
      return next;
    });
  }, []);

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
    () => ({ ...toggles, devMode, toggleDevMode, setToggle }),
    [toggles, devMode, toggleDevMode, setToggle],
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
