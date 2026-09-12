/**
 * ANIMATION CHANNEL — play / pause / resume / stop / speed for an actor's
 * animation clips, with NO Three.js so it runs on the server.
 *
 * A behavior calls `ctx.animation.play("walk")` (or declares
 * `animation: { clip: "walk" }` on a state, which does the same on enter).
 * The channel keeps a small, fully self-describing STATE: which clip, how it
 * loops, its speed, whether it is paused, and the clock times that let any
 * reader compute the exact clip time — so the server can publish the state
 * and every client plays the same frame of the same clip:
 *
 *   clip time (s) = (now − t0) / 1000 × speed          while playing
 *                 = (pausedAt − t0) / 1000 × speed     while paused
 *
 * `now` is whatever clock the owner feeds `setClock`: server time on the
 * server, the local frame clock on a purely local actor. The client applies
 * a published state on its delayed render clock (snapshot interpolation), so a
 * clip switch lands exactly as the interpolated body reaches the spot where
 * the server switched it. Resume/speed changes rewrite `t0` so the clip time
 * stays continuous. A "once" clip holds its last frame.
 */

export type AnimationLoop = "repeat" | "once";

/** What a state declares (or a behavior passes to `play`). */
export interface AnimationSpec {
  /** Clip name in the GLTF. */
  clip: string;
  /** Default "repeat". "once" plays through and holds the last frame. */
  loop?: AnimationLoop;
  /** Playback rate multiplier, default 1. */
  speed?: number;
  /** Restart from time 0 even if this clip is already playing. Default: false
   *  for "repeat" (re-entering a walking state keeps the stride in phase),
   *  true for "once" (a one-shot is a one-shot). */
  restart?: boolean;
}

export interface AnimationState {
  /** null = nothing playing (stopped). */
  clip: string | null;
  loop: AnimationLoop;
  speed: number;
  paused: boolean;
  /** Channel-clock ms at which the clip was at time 0. */
  t0: number;
  /** Channel-clock ms of pause() (meaningful while paused). */
  pausedAt: number;
  /** Channel-clock ms of the last change — readers on a delayed clock apply
   *  the state once their clock reaches this. */
  changedAt: number;
}

export const createAnimationState = (): AnimationState => ({
  clip: null,
  loop: "repeat",
  speed: 1,
  paused: false,
  t0: 0,
  pausedAt: 0,
  changedAt: 0,
});

export const copyAnimationState = (from: AnimationState, to: AnimationState): void => {
  to.clip = from.clip;
  to.loop = from.loop;
  to.speed = from.speed;
  to.paused = from.paused;
  to.t0 = from.t0;
  to.pausedAt = from.pausedAt;
  to.changedAt = from.changedAt;
};

export const animationStatesEqual = (a: AnimationState, b: AnimationState): boolean =>
  a.clip === b.clip &&
  a.loop === b.loop &&
  a.speed === b.speed &&
  a.paused === b.paused &&
  a.t0 === b.t0 &&
  a.pausedAt === b.pausedAt &&
  a.changedAt === b.changedAt;

/** Clip time in SECONDS at channel-clock `nowMs` (unwrapped; the player wraps
 *  looping clips by duration and clamps one-shots). */
export const animationClipTime = (s: AnimationState, nowMs: number): number => {
  const at = s.paused ? s.pausedAt : nowMs;
  return Math.max(0, ((at - s.t0) / 1000) * s.speed);
};

export class AnimationChannel {
  readonly state: AnimationState = createAnimationState();
  /** Bumped on every change — a consumer re-applies when it differs from what it applied. */
  version = 0;
  private now = 0;

  /** The channel clock, set by the runner before behaviors run. */
  setClock(nowMs: number): void {
    this.now = nowMs;
  }

  get clip(): string | null {
    return this.state.clip;
  }

  get playing(): boolean {
    return this.state.clip !== null && !this.state.paused;
  }

  /** Play a clip. Same clip already playing → keeps its phase unless `restart`
   *  (or the clip is a one-shot). Changing loop/speed re-applies in place. */
  play(clip: string, spec: Omit<AnimationSpec, "clip"> = {}): void {
    const s = this.state;
    const loop = spec.loop ?? "repeat";
    const speed = spec.speed ?? 1;
    const restart = spec.restart ?? loop === "once";
    if (s.clip === clip && !restart) {
      let changed = false;
      if (s.paused) {
        this.resume();
        changed = true;
      }
      if (s.loop !== loop) {
        s.loop = loop;
        changed = true;
      }
      if (s.speed !== speed) {
        this.setSpeed(speed);
        changed = true;
      }
      if (changed) this.touch();
      return;
    }
    s.clip = clip;
    s.loop = loop;
    s.speed = speed;
    s.paused = false;
    s.t0 = this.now;
    s.pausedAt = 0;
    this.touch();
  }

  stop(): void {
    const s = this.state;
    if (s.clip === null) return;
    s.clip = null;
    s.paused = false;
    this.touch();
  }

  pause(): void {
    const s = this.state;
    if (s.clip === null || s.paused) return;
    s.paused = true;
    s.pausedAt = this.now;
    this.touch();
  }

  resume(): void {
    const s = this.state;
    if (s.clip === null || !s.paused) return;
    // Shift the origin by the paused duration so the clip time is continuous.
    s.t0 += this.now - s.pausedAt;
    s.paused = false;
    s.pausedAt = 0;
    this.touch();
  }

  /** Change playback rate without a visible jump: the elapsed clip time is
   *  preserved by re-anchoring t0. */
  setSpeed(speed: number): void {
    const s = this.state;
    if (s.clip === null || s.speed === speed) return;
    const at = s.paused ? s.pausedAt : this.now;
    const elapsedS = ((at - s.t0) / 1000) * s.speed;
    s.speed = speed;
    s.t0 = speed !== 0 ? at - (elapsedS / speed) * 1000 : at;
    this.touch();
  }

  /** Adopt a published state wholesale (a mirrored client's local channel). */
  adopt(state: AnimationState): void {
    if (animationStatesEqual(this.state, state)) return;
    copyAnimationState(state, this.state);
    this.version++;
  }

  private touch(): void {
    this.state.changedAt = this.now;
    this.version++;
  }
}
