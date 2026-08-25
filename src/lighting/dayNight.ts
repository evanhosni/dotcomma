import * as THREE from "three";

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

/** Where the sun and moon sit in the sky (unit directions). The celestial
 *  billboards AND the scene's directional light both use these, so daylight
 *  comes from the sun and night light from the moon. */
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.72, -0.6).normalize();
export const MOON_DIRECTION = new THREE.Vector3(-0.45, 0.62, 0.6).normalize();

export type DayNightPhase = "day" | "dusk" | "night" | "dawn";

/** Shared THREE-style uniform mirroring nightBlend — custom shader materials
 *  (terrain, grass) reference this ONE object so every material dims with the
 *  cycle without per-frame uniform writes. */
export const NIGHT_BLEND_UNIFORM = { value: 0 };
/** How dark unlit custom shaders (terrain, grass) get at full night. */
export const NIGHT_GROUND_DIM = 0.22;
/** The GLSL line an unlit custom shader uses to dim `target` (an rgb
 *  expression) by the night blend — expects `uniform float uNightBlend`
 *  bound to NIGHT_BLEND_UNIFORM. */
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

// ---- Building window lights ----

let lightsProgress = 0; // 0 = all off, 1 = every selected window on
let nightIndex = 0; // increments at each nightfall — reshuffles WHICH windows light
let wasNight = false;

/** Advance the lights ramp toward night or day. Lights start turning ON
 *  halfway through the dusk transition, but start turning OFF the moment
 *  dawn begins. Called once per frame by DayNightCycle. */
export const tickWindowLights = (deltaMs: number): void => {
  const isNight = phase === "night" || (phase === "dusk" && nightBlend > 0.5);
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
