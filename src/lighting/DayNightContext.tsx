import { useFrame } from "@react-three/fiber";
import React, { createContext, useContext, useRef, useState } from "react";
import { DayNightPhase, getDayNightPhase, getNightBlend } from "./dayNight";

/**
 * React access to the day/night cycle. Consumers re-render only when the
 * PHASE flips (day → dusk → night → dawn), never per frame — continuous
 * values stay available through the dayNight.ts getters (`getNightBlend()`,
 * `getWindowLightsProgress()`) for useFrame code.
 */

export interface DayNightState {
  phase: DayNightPhase;
  /** True from the midpoint of dusk to the midpoint of dawn. */
  isNight: boolean;
}

const DayNightContext = createContext<DayNightState>({ phase: "day", isNight: false });

/** Mounted inside the Canvas (it polls via useFrame), wrapping the world so
 *  any component can call useDayNight(). */
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
