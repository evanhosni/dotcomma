import * as THREE from "three";

/**
 * THE PERSONAL LIGHT (CLAUDE.md "Tunnels"): the player's own light in the dark — a term of the tunnel
 * shaders around the camera, seen by nobody else, never a scene light. Driven by the daylight at the
 * player's eyes: hysteresis (dark under DARK_BELOW, light again over LIGHT_ABOVE); after DARK_DELAY in
 * the dark it fades in over FADE_IN, out over FADE_OUT once light. The same dark drives a 0–1
 * DARKNESS for the sky (in over DARKNESS_IN, out over DARKNESS_OUT, no delay): the skybox multiplies
 * by its complement, so a hairline seam or an unloaded far end shows the dark, not the sky. The dev
 * FLASHLIGHT (DEV_TOGGLES) is a cone from the camera along its view, switching over FLASH_SWITCH.
 */

export const PERSONAL_LIGHT_UNIFORM = "uPersonalLight";
export const FLASHLIGHT_UNIFORM = "uFlashlight";
export const FLASHLIGHT_DIR_UNIFORM = "uFlashlightDir";

export const PERSONAL_LIGHT_UNIFORMS = {
  [PERSONAL_LIGHT_UNIFORM]: { value: 0 },
  [FLASHLIGHT_UNIFORM]: { value: 0 },
  [FLASHLIGHT_DIR_UNIFORM]: { value: new THREE.Vector3(0, 0, -1) },
};

const DARK_BELOW = 0.08;
const LIGHT_ABOVE = 0.22;
const DARK_DELAY = 1;
const FADE_IN = 2;
const FADE_OUT = 0.6;
const DARKNESS_IN = 1;
const DARKNESS_OUT = 0.4;
const FLASH_SWITCH = 0.25;

let dark = false;
let darkFor = 0;
let personal = 0;
let darkness = 0;
let flashlight = 0;

/** Per frame, with the daylight at the player's eyes (1 when nothing is loaded). */
export const drivePersonalLight = (daylight: number, dt: number): void => {
  if (dark ? daylight > LIGHT_ABOVE : daylight < DARK_BELOW) dark = !dark;
  darkFor = dark ? darkFor + dt : 0;
  const wantLight = dark && darkFor >= DARK_DELAY;
  personal = wantLight ? Math.min(1, personal + dt / FADE_IN) : Math.max(0, personal - dt / FADE_OUT);
  darkness = dark ? Math.min(1, darkness + dt / DARKNESS_IN) : Math.max(0, darkness - dt / DARKNESS_OUT);
  PERSONAL_LIGHT_UNIFORMS[PERSONAL_LIGHT_UNIFORM].value = personal;
};

/** Per frame: the dev flashlight along the camera's view. */
export const driveFlashlight = (on: boolean, viewDir: THREE.Vector3, dt: number): void => {
  flashlight = on ? Math.min(1, flashlight + dt / FLASH_SWITCH) : Math.max(0, flashlight - dt / FLASH_SWITCH);
  PERSONAL_LIGHT_UNIFORMS[FLASHLIGHT_UNIFORM].value = flashlight;
  PERSONAL_LIGHT_UNIFORMS[FLASHLIGHT_DIR_UNIFORM].value.copy(viewDir);
};

/** 0–1: how dark the player's surroundings are (the skybox's blackout). */
export const getDarkness = (): number => darkness;

/** A teleport or domain switch: the player starts in the light. */
export const resetPersonalLight = (): void => {
  dark = false;
  darkFor = 0;
  personal = 0;
  darkness = 0;
  PERSONAL_LIGHT_UNIFORMS[PERSONAL_LIGHT_UNIFORM].value = 0;
};
