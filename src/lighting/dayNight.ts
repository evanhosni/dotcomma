import * as THREE from "three";

// The day/night channels DayNightCycle writes and everything else reads (CLAUDE.md → lighting/).

export const DAY_DURATION_MS = 12000;
export const NIGHT_DURATION_MS = 12000;
/** Sun shrink + moon grow + sky fade. */
export const DAY_NIGHT_CYCLE_TRANSITION_MS = 2000;
/** Window lights stagger on over this span after nightfall (and off at dawn). */
export const LIGHTS_TRANSITION_DURATION_MS = 2000;

export const NIGHT_SKY_COLORS = {
  top: "#0b1026",
  horizon: "#1b2440",
  bottom: "#05060d",
};

/** Used by both the celestial billboards AND the scene's directional light, so shading agrees with the sky. */
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.72, -0.6).normalize();
export const MOON_DIRECTION = new THREE.Vector3(-0.45, 0.62, 0.6).normalize();

export type DayNightPhase = "day" | "dusk" | "night" | "dawn";

/** Unlit custom shaders (terrain, grass) reference this ONE uniform object — no per-frame writes. */
export const NIGHT_BLEND_UNIFORM = { value: 0 };
/** How dark unlit shaders get at full night. */
export const NIGHT_GROUND_DIM = 0.22;
/** Expects `uniform float uNightBlend` bound to NIGHT_BLEND_UNIFORM. */
export const nightDimGLSL = (target: string): string =>
  `${target} *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);`;

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
export const getDayNightPhase = (): DayNightPhase => phase;

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
