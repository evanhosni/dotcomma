export const MAX_COLLIDER_RENDER_DISTANCE = 500;
export const DEFAULT_RENDER_DISTANCE = 500;
export const DEFAULT_FRUSTUM_PADDING = 3;
/** Hard-kill distance as a multiple of renderDistance, when none is given. */
export const DESPAWN_DISTANCE_FACTOR = 1.2;

// Collider activation can mount Rapier trimeshes (several ms each), and actors at
// similar distances cross the gate on the same frame — one activation per window.
// A blocked actor retries at its next check; deactivation is never throttled.
export const COLLIDER_ACTIVATION_WINDOW_S = 0.05;

/** Closer than this (horizontal, squared) the drawn yaw steps from a fixed bearing instead of the camera's:
 *  overhead (the intro's MAV Unit homing onto a head) the camera's bearing swings wildly frame to frame and the
 *  stepped yaw flickered between steps. */
export const YAW_STEP_MIN_DISTANCE_SQ = 3 * 3;
