import { DEFAULT_ANIMATION_PARAMS } from "./defaults";
import type { AnimationLoop, AnimationState, ClipDurations } from "./types";

export const createAnimationState = (): AnimationState => ({
  ...DEFAULT_ANIMATION_PARAMS,
  clip: null,
  paused: false,
  origin: 0,
  anchor: 0,
  changedAt: 0,
  fadeClip: null,
  fadeTime: 0,
  fadeStart: 0,
});

const STATE_KEYS = Object.keys(createAnimationState()) as (keyof AnimationState)[];

export const copyAnimationState = (from: AnimationState, to: AnimationState): void => {
  Object.assign(to, from);
};

export const animationStatesEqual = (a: AnimationState, b: AnimationState): boolean =>
  STATE_KEYS.every((key) => a[key] === b[key]);

/** The clock time of the frame on screen: `nowMs` held at the last tick of a `frameRate` grid shifted by
 *  `phaseMs` (per instance, so a crowd never re-poses on one frame). */
export const frameTimeAt = (nowMs: number, frameRate: number, phaseMs = 0): number => {
  if (!(frameRate > 0)) return nowMs;
  const periodMs = 1000 / frameRate;
  return Math.floor((nowMs + phaseMs) / periodMs) * periodMs - phaseMs;
};

/** Unwrapped clip seconds at `nowMs`; `wrapClipTime` maps it into the clip. */
export const playheadAt = (s: AnimationState, nowMs: number): number => {
  if (s.paused) return s.origin;
  const elapsed = (Math.max(0, nowMs - s.anchor) / 1000) * s.speed;
  return s.origin + (s.reverse ? -elapsed : elapsed);
};

const positiveModulo = (x: number, m: number): number => ((x % m) + m) % m;

export const wrapClipTime = (loop: AnimationLoop, playhead: number, duration: number): number => {
  if (!(duration > 0)) return 0;
  if (loop === "once") return Math.min(Math.max(playhead, 0), duration);
  if (loop === "repeat") return positiveModulo(playhead, duration);
  const t = positiveModulo(playhead, duration * 2);
  return t > duration ? duration * 2 - t : t;
};

/** 0..1 weight of the current clip against the faded-out one. */
export const fadeProgressAt = (s: AnimationState, nowMs: number): number => {
  if (s.fadeClip === null || s.fade <= 0) return 1;
  return Math.min(1, Math.max(0, nowMs - s.fadeStart) / 1000 / s.fade);
};

const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_BYTES = 20;

/** Clip durations straight from a GLB's JSON chunk (the max of each clip's keyframe-time accessors,
 *  which is what three.js computes on load), for readers that never build the model: the server. */
export const glbClipDurations = (bytes: Uint8Array): Record<string, number> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength)));
  const durations: Record<string, number> = {};
  for (const animation of json.animations ?? []) {
    let duration = 0;
    for (const sampler of animation.samplers) duration = Math.max(duration, json.accessors[sampler.input].max?.[0] ?? 0);
    durations[animation.name] = duration;
  }
  return durations;
};

export const proceduralDurations = (clips: readonly { name: string; duration: number }[] = []): ClipDurations =>
  Object.fromEntries(clips.map((c) => [c.name, c.duration]));
