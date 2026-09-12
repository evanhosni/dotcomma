import * as THREE from "three";
import {
  animationClipTime,
  animationStatesEqual,
  copyAnimationState,
  createAnimationState,
  type AnimationState,
} from "./state/animation";

/**
 * ANIMATION PLAYER — applies an AnimationChannel STATE (state/animation.ts,
 * Three-free) to a Three.js mixer. The one place clip state becomes actions,
 * for every model actor:
 *
 *   - a SYNCED actor applies the SERVER's published state, evaluated on its
 *     delayed render clock (server time − INTERP_DELAY_MS), so every client
 *     plays the same clip frame as the interpolated body reaches the spot
 *     where the server switched it;
 *   - a LOCAL actor applies its own runner's channel on the local frame clock.
 *
 * Idempotent: a state equal to the one already applied does nothing, so the
 * per-frame call is a cheap compare. Actions bind LAZILY by clip name (a model
 * may ship many clips its machine never plays) and live on the pooled clone,
 * so a reused clone keeps its bound actions.
 */

export interface AnimationTarget {
  mixer: THREE.AnimationMixer | null;
  animations: THREE.AnimationClip[];
  actions: Map<string, THREE.AnimationAction>;
}

export const getOrCreateAction = (target: AnimationTarget, clipName: string): THREE.AnimationAction | null => {
  const mixer = target.mixer;
  if (!mixer) return null;
  let action = target.actions.get(clipName);
  if (!action) {
    const clip = target.animations.find((c) => c.name === clipName);
    if (!clip) return null;
    action = mixer.clipAction(clip);
    target.actions.set(clipName, action);
  }
  return action;
};

export class AnimationPlayer {
  private readonly applied: AnimationState = createAnimationState();
  private hasApplied = false;

  /** Forget what was applied (a fresh pooled clone, a new life). */
  reset(): void {
    this.hasApplied = false;
  }

  /** Apply `state` unless it is exactly what is already playing. `nowMs` is
   *  the clock the state's times are expressed in. */
  apply(target: AnimationTarget, state: AnimationState, nowMs: number): void {
    if (this.hasApplied && animationStatesEqual(this.applied, state)) return;
    copyAnimationState(state, this.applied);
    this.hasApplied = true;
    if (!target.mixer) return;

    if (state.clip === null) {
      target.actions.forEach((a) => a.stop());
      return;
    }
    const action = getOrCreateAction(target, state.clip);
    if (!action) {
      console.error(`animation "${state.clip}" does not exist`);
      return;
    }
    // Stop the materialized actions to clear the mixer (clips nothing ever
    // played were never bound — there's nothing else to stop).
    target.actions.forEach((a) => {
      if (a !== action) a.stop();
    });
    const once = state.loop === "once";
    const duration = action.getClip().duration;
    const t = animationClipTime(state, nowMs);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = state.speed;
    action.time = once ? Math.min(t, duration) : duration > 0 ? t % duration : 0;
    action.play();
    action.paused = state.paused;
  }
}
