// The day/night channels DayNightCycle writes and everything else reads (CLAUDE.md → lighting/).
import type { DayNightPhase } from "./types";
import { NIGHT_BLEND_UNIFORM } from "./material";
import { LIGHTS_TRANSITION_DURATION_MS } from "./constants";

let nightBlend = 0; // 0 = full day, 1 = full night
let phase: DayNightPhase = "day";

export const setNightBlend = (blend: number): void => {
  phase =
    blend <= 0.001
      ? "day"
      : blend >= 0.999
        ? "night"
        : blend > nightBlend
          ? "dusk"
          : blend < nightBlend
            ? "dawn"
            : phase;
  nightBlend = blend;
  NIGHT_BLEND_UNIFORM.value = blend;
};

export const getNightBlend = (): number => nightBlend;

let windowLightsProgress = 0; // 0 = all off, 1 = every selected window on
let nightIndex = 0; // reshuffles WHICH windows light each nightfall
let wasNightLastTick = false;

/** Lights start turning ON halfway through dusk but OFF the moment dawn begins. */
export const tickWindowLights = (deltaMs: number): void => {
  const isNight = phase === "night" || (phase === "dusk" && nightBlend > 0.5);
  if (isNight && !wasNightLastTick) nightIndex++;
  wasNightLastTick = isNight;
  const target = isNight ? 1 : 0;
  const step = deltaMs / LIGHTS_TRANSITION_DURATION_MS;
  windowLightsProgress =
    target > windowLightsProgress ? Math.min(target, windowLightsProgress + step) : Math.max(target, windowLightsProgress - step);
};

export const getWindowLightsProgress = (): number => windowLightsProgress;
/** Holds through dawn, so the same windows that lit turn off. */
export const getNightIndex = (): number => nightIndex;
