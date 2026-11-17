import type { Vector3Tuple } from "three";

/** The screen's center: on the axis the player spawns facing, in conversation distance of the title. */
export const CRT_POSITION: Vector3Tuple = [0, 2.2, -36];

/** Its glow light, relative to the screen center; the home grid (home/shaders/fragment.glsl) is lit from the same point. */
export const CRT_GLOW = {
  offset: [0, 0.3, 5] as Vector3Tuple,
  color: "#8fffc8",
  intensity: 26,
  distance: 24,
};
