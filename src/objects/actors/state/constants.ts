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

/** The built-in state EVERY machine has (state/utils.ts ragdollStatesOf): the body goes limp, the behavior
 *  stops, and each client simulates the fall (objects/actors/ragdoll/). Entered by `setRagdoll(true)` or by
 *  any transition targeting it (a death, a hard hit); left only by `setRagdoll(false)`. */
export const RAGDOLL_STATE = "ragdoll";
/** The built-in state after it: the body blends back up into the machine's recover clip, then the machine
 *  restarts at its initial state (unless held: `setRagdoll(false, undefined, true)`). */
export const RECOVER_STATE = "ragdoll-recover";
export const DEFAULT_RECOVER_SECONDS = 2;
/** The blackboard key (and, for a synced actor, the replicated entity-state key) of the impulse the ragdoll
 *  starts with (RagdollImpulse). */
export const RAGDOLL_IMPULSE_KEY = "ragdollImpulse";
/** Blackboard key: the recover state holds its last frame instead of returning to the initial state. */
export const RECOVER_HOLD_KEY = "__ragdoll_hold";
