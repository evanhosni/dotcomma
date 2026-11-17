/** The hover raycast runs every this many frames (phase-offset per instance by `framePhase`). */
export const MOUSE_RAYCAST_INTERVAL_FRAMES = 3;

/** Past `reach`, padded for the model's height/radius: the camera is too far for any hit. */
export const RAYCAST_RANGE_PAD = 3;

// Angular pre-test: the per-triangle CPU-skinned test below is expensive and the
// ×3-inflated sphere reject rarely rejects, so skip actors more than ~18° off the
// view ray — except very close ones, where the normalized direction is unstable.
export const VIEW_CONE_COS = Math.cos((18 * Math.PI) / 180);
export const VIEW_CONE_SKIP_WITHIN_SQ = 16;
/** Bounding spheres are inflated this much for animated poses. */
export const ANIMATED_BOUNDS_INFLATE = 3;
