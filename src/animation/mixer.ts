import * as THREE from "three";
import type { AnimationConfig, AnimationInputs, AnimationState, ProceduralClip, ProceduralLayer, ProceduralLayerPose, ProceduralPose } from "./types";
import { animationStatesEqual, copyAnimationState, createAnimationState, fadeProgressAt, frameTimeAt, playheadAt, wrapClipTime } from "./utils";

export interface AnimationTarget {
  mixer: THREE.AnimationMixer | null;
  animations: THREE.AnimationClip[];
  /** Bound lazily by clip name; they live on the (pooled) model, so a reused one keeps them. */
  actions: Map<string, THREE.AnimationAction>;
}

export const getOrCreateAction = (target: AnimationTarget, clipName: string): THREE.AnimationAction | null => {
  if (!target.mixer) return null;
  let action = target.actions.get(clipName);
  if (!action) {
    const clip = target.animations.find((c) => c.name === clipName);
    if (!clip) return null;
    action = target.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    target.actions.set(clipName, action);
  }
  return action;
};

const reportedMissing = new Set<string>();
const reportMissing = (clip: string): void => {
  if (reportedMissing.has(clip)) return;
  reportedMissing.add(clip);
  console.error(`animation "${clip}" does not exist`);
};

const poseAction = (action: THREE.AnimationAction, time: number, weight: number): void => {
  action.enabled = true;
  action.paused = false;
  action.time = time;
  action.setEffectiveWeight(weight);
  action.play();
};

interface PosedFrame {
  clip: string | null;
  time: number;
  weight: number;
  fadeClip: string | null;
  fadeTime: number;
  fadeWeight: number;
}

const unposedFrame = (): PosedFrame => ({ clip: null, time: NaN, weight: NaN, fadeClip: null, fadeTime: NaN, fadeWeight: NaN });

const framesEqual = (a: PosedFrame, b: PosedFrame): boolean =>
  a.clip === b.clip && a.time === b.time && a.weight === b.weight && a.fadeClip === b.fadeClip && a.fadeTime === b.fadeTime && a.fadeWeight === b.fadeWeight;

/** Poses a model from an AnimationChannel's state. The clip time is computed from the state and the
 *  clock every call (never accumulated), so skipped calls cost nothing and resume in phase; the
 *  skeleton is evaluated only when the posed frame changes (at the state's frame rate), and the layers
 *  are posed over it on the same frame grid. */
export class AnimationPlayer {
  private readonly state = createAnimationState();
  private hasState = false;
  private readonly procedural: ReadonlyMap<string, ProceduralClip>;
  private live: { clip: ProceduralClip; pose: ProceduralPose } | null = null;
  private posed = unposedFrame();
  private next = unposedFrame();
  private readonly layers: readonly ProceduralLayer[];
  private liveLayers: ProceduralLayerPose[] | null = null;
  private layerFrame = NaN;

  constructor({ procedural = [], layers = [] }: AnimationConfig = {}) {
    this.procedural = new Map(procedural.map((c) => [c.name, c]));
    this.layers = layers;
  }

  /** Forgets the model's pose (a pooled model reused, or released). */
  reset(): void {
    this.disposeLive();
    this.liveLayers?.forEach((layer) => layer.dispose());
    this.liveLayers = null;
    this.hasState = false;
    this.posed = unposedFrame();
    this.layerFrame = NaN;
  }

  /** `state` null keeps posing the last one taken (a delayed reader waiting for a change's time).
   *  `root` is what procedural clips and layers pose; `phaseMs` shifts this instance's frame grid.
   *  True when anything was re-posed (the skeleton's bone matrices are stale). */
  update(
    target: AnimationTarget,
    root: THREE.Object3D | null,
    state: AnimationState | null,
    inputs: Readonly<AnimationInputs>,
    nowMs: number,
    phaseMs = 0,
  ): boolean {
    if (state && !(this.hasState && animationStatesEqual(state, this.state))) {
      copyAnimationState(state, this.state);
      this.hasState = true;
    }
    if (!this.hasState) return false;
    const frameMs = frameTimeAt(nowMs, this.state.frameRate, phaseMs);
    const clipPosed = this.poseClip(target, root, frameMs);
    const layersPosed = !!root && this.layers.length > 0 && this.poseLayers(root, inputs, frameMs, clipPosed);
    return clipPosed || layersPosed;
  }

  /** True when the clip was re-posed (which overwrote whatever the layers had written). */
  private poseClip(target: AnimationTarget, root: THREE.Object3D | null, nowMs: number): boolean {

    const s = this.state;
    const procedural = s.clip === null ? undefined : this.procedural.get(s.clip);
    const action = s.clip === null || procedural ? null : getOrCreateAction(target, s.clip);
    if (s.clip !== null && !procedural && !action) {
      reportMissing(s.clip);
      return false;
    }
    const duration = procedural ? procedural.duration : (action?.getClip().duration ?? 0);
    const fade = fadeProgressAt(s, nowMs);
    const fadeAction = !procedural && fade < 1 && s.fadeClip !== null && s.fadeClip !== s.clip ? getOrCreateAction(target, s.fadeClip) : null;

    const frame = this.next;
    frame.clip = s.clip;
    frame.time = wrapClipTime(s.loop, playheadAt(s, nowMs), duration);
    frame.weight = s.intensity * (fadeAction ? fade : 1);
    frame.fadeClip = fadeAction ? s.fadeClip : null;
    frame.fadeTime = fadeAction ? Math.min(Math.max(s.fadeTime, 0), fadeAction.getClip().duration) : 0;
    frame.fadeWeight = fadeAction ? s.intensity * (1 - fade) : 0;
    if (framesEqual(frame, this.posed)) return false;

    if (procedural) {
      if (!root) return false;
      if (this.live?.clip !== procedural) {
        this.disposeLive();
        this.live = { clip: procedural, pose: procedural.create(root) };
      }
      this.live.pose.pose(frame.time, frame.weight);
    } else {
      this.disposeLive();
      target.actions.forEach((a) => {
        if (a !== action && a !== fadeAction) a.stop();
      });
      if (action) {
        poseAction(action, frame.time, frame.weight);
        if (fadeAction) poseAction(fadeAction, frame.fadeTime, frame.fadeWeight);
        target.mixer!.update(0);
      }
    }
    this.next = this.posed;
    this.posed = frame;
    return true;
  }

  private poseLayers(root: THREE.Object3D, inputs: Readonly<AnimationInputs>, frameMs: number, clipPosed: boolean): boolean {
    if (!clipPosed && frameMs === this.layerFrame) return false;
    this.layerFrame = frameMs;
    this.liveLayers ??= this.layers.map((layer) => layer.create(root));
    for (const layer of this.liveLayers) layer.pose(inputs, this.state.intensity);
    return true;
  }

  private disposeLive(): void {
    this.live?.pose.dispose();
    this.live = null;
  }
}
