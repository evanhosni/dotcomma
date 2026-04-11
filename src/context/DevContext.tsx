import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface DevState {
  devMode: boolean;
  noclip: boolean;
  physicsDebug: boolean;
  toggleDevMode: () => void;
  setNoclip: (v: boolean) => void;
  setPhysicsDebug: (v: boolean) => void;
}

const DevContext = createContext<DevState>(null!);

function readDevParam(): boolean {
  return new URLSearchParams(window.location.search).has("devmode");
}

function writeDevParam(devMode: boolean) {
  const url = new URL(window.location.href);
  if (devMode) url.searchParams.set("devmode", "");
  else url.searchParams.delete("devmode");
  window.history.replaceState(null, "", url.toString());
}

export const DevProvider = ({ children }: { children: React.ReactNode }) => {
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

  // F1 toggles devmode
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

  const value = useMemo(
    () => ({ devMode, noclip, physicsDebug, toggleDevMode, setNoclip, setPhysicsDebug }),
    [devMode, noclip, physicsDebug, toggleDevMode],
  );

  return <DevContext.Provider value={value}>{children}</DevContext.Provider>;
};

export const useDevMode = () => useContext(DevContext);
