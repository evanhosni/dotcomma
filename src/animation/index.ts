import { DEFAULT_ANIMATION_PARAMS } from "./defaults";
import type { AnimationChannelOptions, AnimationInputs, AnimationLoop, AnimationParams, AnimationSpec, AnimationState, ClipDurations } from "./types";
import { animationStatesEqual, copyAnimationState, createAnimationState, playheadAt, wrapClipTime } from "./utils";

const PARAM_KEYS = Object.keys(DEFAULT_ANIMATION_PARAMS) as (keyof AnimationParams)[];

const resolveParams = (base: AnimationParams, overrides: Partial<AnimationParams> = {}): AnimationParams => {
  const out = { ...base };
  for (const key of PARAM_KEYS) if (overrides[key] !== undefined) (out as any)[key] = overrides[key];
  return out;
};

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** Three-free: the state machine drives it (the server's copy is THE one, published to every client),
 *  and `AnimationPlayer` (mixer.ts) poses a model from its state. `setClock` feeds the clock every time
 *  is expressed in. */
export class AnimationChannel {
  readonly state: AnimationState = createAnimationState();
  /** Local to each machine and never published: a synced client's mirror writes its own. */
  readonly inputs: AnimationInputs = {};
  /** Bumped on every change: a publisher re-sends when it differs from what it sent. */
  version = 0;
  private now = 0;
  private readonly defaults: AnimationParams;
  private readonly durations: ClipDurations;

  constructor({ defaults, durations = {} }: AnimationChannelOptions = {}) {
    this.defaults = resolveParams(DEFAULT_ANIMATION_PARAMS, defaults);
    this.durations = durations;
  }

  setClock(nowMs: number): void {
    this.now = nowMs;
  }

  get clip(): string | null {
    return this.state.clip;
  }

  get playing(): boolean {
    return this.state.clip !== null && !this.state.paused;
  }

  get paused(): boolean {
    return this.state.paused;
  }

  /** Clip seconds on screen now (the unwrapped playhead when the clip's duration is unknown). */
  get time(): number {
    const s = this.state;
    const playhead = playheadAt(s, this.now);
    const duration = this.durationOf(s.clip);
    return duration === undefined ? playhead : wrapClipTime(s.loop, playhead, duration);
  }

  /** A "once" clip that has reached its last frame (its first, reversed). */
  get finished(): boolean {
    const s = this.state;
    const duration = this.durationOf(s.clip);
    if (s.loop !== "once" || duration === undefined) return false;
    const t = this.time;
    return s.reverse ? t <= 0 : t >= duration;
  }

  /** The same clip, unless `restart`, keeps its phase and takes the new params. */
  play(clip: string, spec: Omit<AnimationSpec, "clip"> = {}): void {
    const s = this.state;
    const params = resolveParams(this.defaults, spec);
    const restart = spec.restart ?? params.loop === "once";
    if (s.clip === clip && !restart) {
      if (!s.paused && PARAM_KEYS.every((key) => s[key] === params[key])) return;
      this.rebase();
      Object.assign(s, params);
      s.paused = false;
      s.anchor = this.now;
      this.touch();
      return;
    }
    if (s.clip !== null && s.clip !== clip && params.fade > 0) {
      s.fadeClip = s.clip;
      s.fadeTime = this.time;
      s.fadeStart = this.now;
    } else {
      s.fadeClip = null;
    }
    Object.assign(s, params);
    s.clip = clip;
    s.paused = false;
    s.origin = params.reverse ? (this.durationOf(clip) ?? 0) : 0;
    s.anchor = this.now;
    this.touch();
  }

  stop(): void {
    const s = this.state;
    if (s.clip === null) return;
    s.clip = null;
    s.paused = false;
    s.fadeClip = null;
    this.touch();
  }

  pause(): void {
    if (this.state.clip === null || this.state.paused) return;
    this.rebase();
    this.state.paused = true;
    this.touch();
  }

  resume(): void {
    const s = this.state;
    if (s.clip === null || !s.paused) return;
    s.paused = false;
    s.anchor = this.now;
    this.touch();
  }

  setInput(name: string, value: number | undefined): void {
    this.inputs[name] = value;
  }

  togglePause(): void {
    if (this.state.paused) this.resume();
    else this.pause();
  }

  /** Flips the direction from the frame on screen. */
  reverse(): void {
    this.setReverse(!this.state.reverse);
  }

  setReverse(reverse: boolean): void {
    this.change("reverse", reverse);
  }

  setSpeed(speed: number): void {
    this.change("speed", Math.max(0, speed));
  }

  setFrameRate(frameRate: number): void {
    this.change("frameRate", Math.max(0, frameRate));
  }

  setLoop(loop: AnimationLoop): void {
    this.change("loop", loop);
  }

  setIntensity(intensity: number): void {
    const s = this.state;
    const next = clamp01(intensity);
    if (s.clip === null || s.intensity === next) return;
    s.intensity = next;
    this.touch();
  }

  /** Jumps to `seconds` into the clip. */
  seek(seconds: number): void {
    const s = this.state;
    if (s.clip === null) return;
    s.origin = this.normalize(seconds);
    s.anchor = this.now;
    this.touch();
  }

  /** Adopts a published state wholesale (a mirrored client's local channel). */
  adopt(state: AnimationState): void {
    if (animationStatesEqual(this.state, state)) return;
    copyAnimationState(state, this.state);
    this.version++;
  }

  /** Changes a param that shapes the playhead: the frame on screen stays put. */
  private change<K extends "reverse" | "speed" | "frameRate" | "loop">(key: K, value: AnimationState[K]): void {
    const s = this.state;
    if (s.clip === null || s[key] === value) return;
    this.rebase();
    s[key] = value;
    this.touch();
  }

  private rebase(): void {
    const s = this.state;
    if (!s.paused) s.origin = this.normalize(playheadAt(s, this.now));
    s.anchor = this.now;
  }

  private durationOf(clip: string | null): number | undefined {
    return clip === null ? undefined : this.durations[clip];
  }

  /** Keeps the stored playhead small without moving the frame (a ping-pong keeps its direction phase). */
  private normalize(playhead: number): number {
    const s = this.state;
    const duration = this.durationOf(s.clip);
    if (duration === undefined || !(duration > 0)) return playhead;
    if (s.loop === "once") return wrapClipTime("once", playhead, duration);
    const period = s.loop === "pingpong" ? duration * 2 : duration;
    return ((playhead % period) + period) % period;
  }

  private touch(): void {
    this.state.changedAt = this.now;
    this.version++;
  }
}

export type {
  AnimationChannelOptions,
  AnimationConfig,
  AnimationInputs,
  AnimationLoop,
  AnimationParams,
  AnimationSpec,
  AnimationState,
  ClipDurations,
  ProceduralClip,
  ProceduralLayer,
  ProceduralLayerPose,
  ProceduralPose,
} from "./types";
export { DEFAULT_ANIMATION_PARAMS } from "./defaults";
