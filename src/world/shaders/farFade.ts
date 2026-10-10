import * as THREE from "three";
import { CAMERA_FAR } from "../../player/constants";
import { FAR_FADE_FRACTION } from "./constants";

/**
 * The ground's FAR FADE: terrain and water dither out over the last FAR_FADE_FRACTION of the camera's far
 * distance (the same screen-door pattern as every object fade, vfx/dither.ts), so the horizon dissolves into
 * the sky instead of being cut by the far plane. The range follows the LIVE camera.far (setFarFade, every
 * frame from TerrainRenderer). Measured as the horizontal camera distance, the one world curvature uses. The
 * fraction is FAR_FADE_FRACTION (shaders/constants.ts).
 */

export const FAR_FADE_DEFINE = "TERRAIN_FAR_FADE";
export const FAR_FADE_UNIFORM = "uFarFade";

/** [start, end] of the fade, shared by every terrain and water material. */
export const FAR_FADE_UNIFORMS = { [FAR_FADE_UNIFORM]: { value: new THREE.Vector2() } };

export const setFarFade = (cameraFar: number): void => {
  FAR_FADE_UNIFORMS[FAR_FADE_UNIFORM].value.set(cameraFar * (1 - FAR_FADE_FRACTION), cameraFar);
};
setFarFade(CAMERA_FAR);

/** Vertex stage: the horizontal camera distance of a pre-curvature view-space position. */
export const FAR_DISTANCE_GLSL = /* glsl */ `
  float farFadeDistance(vec3 viewPos) {
    vec3 up = viewMatrix[1].xyz;
    return length(viewPos - up * dot(viewPos, up));
  }
`;

/** Fragment stage; needs SCREEN_DOOR_GLSL declared before it. Eased like the sprites' far fade. */
export const FAR_FADE_GLSL = /* glsl */ `
  bool farFadeDiscards(float distance, vec2 range) {
    float visibility = smoothstep(0.0, 1.0, clamp((range.y - distance) / max(range.y - range.x, 1e-3), 0.0, 1.0));
    return visibility < 1.0 && visibility <= screenDoorThreshold(gl_FragCoord.xy);
  }
`;
