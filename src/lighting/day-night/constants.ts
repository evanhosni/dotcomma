import * as THREE from "three";

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
/** How dark unlit shaders get at full night. */
export const NIGHT_GROUND_DIM = 0.22;
