/**
 * Three-free animation channel: a self-describing STATE the server can publish so
 * every client plays the same frame of the same clip.
 *
 *   clip time (s) = (now − t0) / 1000 × speed          while playing
 *                 = (pausedAt − t0) / 1000 × speed     while paused
 *
 * `now` is whatever clock `setClock` feeds (server time on the server, the local
 * frame clock on a local actor). Resume/speed changes rewrite `t0` so the clip
 * time stays continuous.
 */

export type AnimationLoop = "repeat" | "once";

export interface AnimationSpec {
  clip: string;
  /** Default "repeat". "once" plays through and holds the last frame. */
  loop?: AnimationLoop;
  /** Default 1. */
  speed?: number;
  /** Default: false for "repeat" (re-entering a walking state keeps the stride in phase), true for "once". */
  restart?: boolean;
}

export interface AnimationState {
  /** null = stopped. */
  clip: string | null;
  loop: AnimationLoop;
  speed: number;
  paused: boolean;
  /** Channel-clock ms at which the clip was at time 0. */
  t0: number;
  /** Channel-clock ms of pause() (meaningful while paused). */
  pausedAt: number;
  /** Channel-clock ms of the last change — readers on a delayed clock apply the state once they reach it. */
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

/** Unwrapped clip time in SECONDS; the player wraps loops by duration and clamps one-shots. */
export const animationClipTime = (s: AnimationState, nowMs: number): number => {
  const at = s.paused ? s.pausedAt : nowMs;
  return Math.max(0, ((at - s.t0) / 1000) * s.speed);
};

export class AnimationChannel {
  readonly state: AnimationState = createAnimationState();
  /** Bumped on every change — a consumer re-applies when it differs from what it applied. */
  version = 0;
  private now = 0;

  setClock(nowMs: number): void {
    this.now = nowMs;
  }

  get clip(): string | null {
    return this.state.clip;
  }

  get playing(): boolean {
    return this.state.clip !== null && !this.state.paused;
  }

  /** Same clip already playing keeps its phase unless `restart` (or a one-shot). */
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
    s.t0 += this.now - s.pausedAt;
    s.paused = false;
    s.pausedAt = 0;
    this.touch();
  }

  /** Re-anchors t0 so the elapsed clip time is preserved (no visible jump). */
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
