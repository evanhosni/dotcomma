import * as THREE from "three";
import {
  animationClipTime,
  animationStatesEqual,
  copyAnimationState,
  createAnimationState,
  type AnimationState,
} from "./state/animation";

/**
 * Applies an AnimationChannel STATE to a Three.js mixer — the one place clip state
 * becomes actions. Idempotent (an equal state is a cheap compare). Actions bind
 * LAZILY by clip name and live on the pooled clone, so a reused clone keeps them.
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

  reset(): void {
    this.hasApplied = false;
  }

  /** `nowMs` is the clock the state's times are expressed in. */
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
