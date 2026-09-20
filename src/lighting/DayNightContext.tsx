import { useFrame } from "@react-three/fiber";
import React, { createContext, useContext, useRef, useState } from "react";
import { DayNightPhase, getDayNightPhase, getNightBlend } from "./dayNight";

// Re-renders only on phase flips; continuous values come from the dayNight.ts getters.

export interface DayNightState {
  phase: DayNightPhase;
  /** True from the midpoint of dusk to the midpoint of dawn. */
  isNight: boolean;
}

const DayNightContext = createContext<DayNightState>({ phase: "day", isNight: false });

/** Must mount inside the Canvas (polls via useFrame). */
export const DayNightProvider = ({ children }: React.PropsWithChildren) => {
  const [state, setState] = useState<DayNightState>(() => ({
    phase: getDayNightPhase(),
    isNight: getNightBlend() > 0.5,
  }));
  const currentRef = useRef(state);

  useFrame(() => {
    const phase = getDayNightPhase();
    const isNight = getNightBlend() > 0.5;
    if (phase !== currentRef.current.phase || isNight !== currentRef.current.isNight) {
      currentRef.current = { phase, isNight };
      setState(currentRef.current);
    }
  });

  return <DayNightContext.Provider value={state}>{children}</DayNightContext.Provider>;
};

export const useDayNight = (): DayNightState => useContext(DayNightContext);
