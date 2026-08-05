/**
 * Day/night cycle timing constants + the tiny channel the DayNightCycle
 * writes and the SkyboxSystem reads (sky colors blend toward the night
 * palette by this factor, on top of whatever scoped skybox is active).
 */

export const DAY_DURATION_MS = 12000;
export const NIGHT_DURATION_MS = 12000;
/** Length of the sunset/sunrise transition (sun shrink + moon grow + sky fade). */
export const DAY_NIGHT_CYCLE_TRANSITION_MS = 2000;

export const NIGHT_SKY_COLORS = {
  top: "#0b1026",
  horizon: "#1b2440",
  bottom: "#05060d",
};

let nightBlend = 0; // 0 = full day, 1 = full night

export const setNightBlend = (blend: number): void => {
  nightBlend = blend;
};

export const getNightBlend = (): number => nightBlend;
