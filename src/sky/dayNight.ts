/**
 * Day/night cycle timing constants + the tiny channels the DayNightCycle
 * writes and other systems read:
 *
 * - nightBlend (0 = full day, 1 = full night): SkyboxSystem blends sky
 *   colors toward the night palette by this factor.
 * - phase ("day" | "dusk" | "night" | "dawn"): derived from the blend's
 *   value and direction; surfaced to React via DayNightContext.
 * - window lights progress (0..1): ramps up over LIGHTS_TRANSITION_DURATION_MS
 *   once night takes hold and back down at dawn. Buildings compare it to each
 *   lit window's seeded threshold, so windows pop on/off sporadically instead
 *   of all at once.
 */

export const DAY_DURATION_MS = 12000;
export const NIGHT_DURATION_MS = 12000;
/** Length of the sunset/sunrise transition (sun shrink + moon grow + sky fade). */
export const DAY_NIGHT_CYCLE_TRANSITION_MS = 2000;
/** Window lights stagger on over this span after nightfall (and off at dawn). */
export const LIGHTS_TRANSITION_DURATION_MS = 2000;

export const NIGHT_SKY_COLORS = {
  top: "#0b1026",
  horizon: "#1b2440",
  bottom: "#05060d",
};

export type DayNightPhase = "day" | "dusk" | "night" | "dawn";

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
};

export const getNightBlend = (): number => nightBlend;
export const getDayNightPhase = (): DayNightPhase => phase;

// ---- Building window lights ----

let lightsProgress = 0; // 0 = all off, 1 = every selected window on
let nightIndex = 0; // increments at each nightfall — reshuffles WHICH windows light
let wasNight = false;

/** Advance the lights ramp toward night or day. Lights react at the very
 *  START of each blend transition: on the moment dusk begins, off the moment
 *  dawn begins. Called once per frame by DayNightCycle. */
export const tickWindowLights = (deltaMs: number): void => {
  const isNight = phase === "dusk" || phase === "night";
  if (isNight && !wasNight) nightIndex++; // new night, new set of lit windows
  wasNight = isNight;
  const target = isNight ? 1 : 0;
  const step = deltaMs / LIGHTS_TRANSITION_DURATION_MS;
  lightsProgress =
    target > lightsProgress ? Math.min(target, lightsProgress + step) : Math.max(target, lightsProgress - step);
};

export const getWindowLightsProgress = (): number => lightsProgress;
/** Which night we're on — window selection re-rolls off this each nightfall
 *  (the seed holds through dawn, so the same windows that lit turn off). */
export const getNightIndex = (): number => nightIndex;
