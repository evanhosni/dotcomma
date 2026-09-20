import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DevContextType } from "./types";

const DevContext = createContext<DevContextType | undefined>(undefined);

interface DevContextProviderProps {
  children: ReactNode;
}

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
  const [noclip, setNoclip] = useState(false);
  const [physicsDebug, setPhysicsDebug] = useState(false);

  const toggleDevMode = useCallback(() => {
    setDevMode((prev) => {
      const next = !prev;
      writeDevParam(next);
      if (!next) {
        setNoclip(false);
        setPhysicsDebug(false);
      }
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
    () => ({ devMode, noclip, physicsDebug, toggleDevMode, setNoclip, setPhysicsDebug }),
    [devMode, noclip, physicsDebug, toggleDevMode],
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

export default DevContext;
