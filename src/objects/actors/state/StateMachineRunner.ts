import { AnimationChannel } from "../../../animation/AnimationChannel";
import { Input } from "./input";
import { Motion } from "./motion";
import type { Vec3Like, BehaviorContext, StateDef, StateMachineConfig, ResolvedTransition, RunnerOptions } from "./types";
import { getConfigMaps, mouseFlagOf } from "./utils";
import { MOUSE_ONE_SHOT_FLAGS } from "./enums";

/**
 * The Three-free state machine core. The SAME config file runs on the server
 * (the one authority; its `motion`/`animation` outputs are published) and on
 * the client (local actors tick; synced actors follow the server's state id so
 * state-keyed visuals run). THE AUTHORING CONTRACT: movement through
 * `ctx.motion`, animation through `ctx.animation` — never the scene; anything
 * scene-bound guards on `ctx.groupRef.current` (null on the server); no Three at
 * runtime in a config (`import type`); `Math.random` is fine.
 */

export class StateMachineRunner {
  readonly blackboard: Record<string, any> = {};
  readonly motion: Motion;
  readonly animation: AnimationChannel;
  readonly input = new Input(this.blackboard);
  private readonly stateMap: Map<string, StateDef>;
  private readonly transitionsOf: Map<string, ResolvedTransition[]>;
  private stateId: string;
  private stateEnteredAt = 0;
  private exitCleanup: (() => void) | null = null;
  private entered = false;
  /** ONE context object per instance, mutated per tick — no allocation. */
  private readonly ctx: BehaviorContext;

  constructor(
    private readonly config: StateMachineConfig,
    positionRef: { current: Vec3Like },
    groupRef: { current: any },
    options: RunnerOptions = {},
  ) {
    this.animation = new AnimationChannel(options.animation);
    const maps = getConfigMaps(config);
    this.stateMap = maps.stateMap;
    this.transitionsOf = maps.transitionsOf;
    this.stateId = config.initialState;
    this.motion = new Motion(positionRef, options.motion);
    this.ctx = {
      positionRef: positionRef as BehaviorContext["positionRef"],
      playerPosition: positionRef.current as BehaviorContext["playerPosition"],
      playerDistanceSq: Infinity,
      delta: 0,
      elapsed: 0,
      stateElapsed: 0,
      blackboard: this.blackboard,
      motion: this.motion,
      animation: this.animation,
      input: this.input,
      groupRef: groupRef as BehaviorContext["groupRef"],
    };
  }

  get currentStateId(): string {
    return this.stateId;
  }

  forceTransition(stateId: string): void {
    this.blackboard.__forcedTransition = stateId;
  }

  private runExitCleanup(): void {
    if (!this.exitCleanup) return;
    this.exitCleanup();
    this.exitCleanup = null;
  }

  private enterState(stateId: string, elapsed: number): void {
    this.runExitCleanup();
    const state = this.stateMap.get(stateId);
    if (!state) return;
    this.stateId = stateId;
    this.stateEnteredAt = elapsed;
    if (state.animation) {
      const { clip, ...spec } = state.animation;
      this.animation.play(clip, spec);
    }
    if (state.onEnter) {
      const cleanup = state.onEnter(this.ctx);
      if (typeof cleanup === "function") this.exitCleanup = cleanup;
    }
  }

  /** Enters a state and runs its first update on the same tick. */
  private enterAndUpdate(stateId: string, elapsed: number): void {
    this.enterState(stateId, elapsed);
    this.stateMap.get(this.stateId)?.onUpdate?.(this.ctx);
  }

  private prepare(elapsed: number, delta: number, clockMs: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    const c = this.ctx;
    c.playerPosition = playerPosition as BehaviorContext["playerPosition"];
    c.playerDistanceSq = playerDistanceSq;
    c.delta = delta;
    c.elapsed = elapsed;
    c.stateElapsed = elapsed - this.stateEnteredAt;
    this.animation.setClock(clockMs);
  }

  /** AUTHORITATIVE step. `elapsed`/`delta` in seconds; `clockMs` is the animation
   *  clock (server time on the server, the local frame clock on a local actor). */
  tick(elapsed: number, delta: number, clockMs: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    this.prepare(elapsed, delta, clockMs, playerPosition, playerDistanceSq);
    const bb = this.blackboard;

    if (!this.entered) {
      this.entered = true;
      this.enterState(this.config.initialState, elapsed);
    }

    const forced = bb.__forcedTransition;
    if (forced) {
      delete bb.__forcedTransition;
      this.enterAndUpdate(forced, elapsed);
      return;
    }

    const current = this.stateMap.get(this.stateId);
    if (!current) return;

    for (const transition of this.transitionsOf.get(this.stateId)!) {
      if (transition.trigger.evaluate(this.ctx)) {
        if (transition.guard && !transition.guard(this.ctx)) continue;
        this.enterAndUpdate(transition.target, elapsed);
        this.clearMouseFlags();
        return;
      }
    }

    current.onUpdate?.(this.ctx);
    this.clearMouseFlags();
  }

  /** FOLLOWER step (synced client): adopt the server's state id, running
   *  onEnter/cleanup as the server did, and run the behavior for its visual side
   *  effects. Outputs written here are ignored in favor of the server's. */
  followServerState(stateId: string, elapsed: number, delta: number, clockMs: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    this.prepare(elapsed, delta, clockMs, playerPosition, playerDistanceSq);
    if (!this.entered || this.stateId !== stateId) {
      this.entered = true;
      this.enterState(stateId, elapsed);
    }
    this.stateMap.get(this.stateId)?.onUpdate?.(this.ctx);
    this.clearMouseFlags();
  }

  private clearMouseFlags(): void {
    const bb = this.blackboard;
    if (!bb.__mouse_dirty) return;
    bb.__mouse_dirty = false;
    for (let i = 0; i < MOUSE_ONE_SHOT_FLAGS.length; i++) bb[MOUSE_ONE_SHOT_FLAGS[i]] = false;
  }

  raise(flag: string): void {
    this.blackboard[flag] = true;
    this.blackboard.__mouse_dirty = true;
  }

  /** Raise the flag a forwarded mouse ACTION names; false if it isn't one. */
  raiseMouseAction(action: string): boolean {
    const flag = mouseFlagOf(action);
    if (!flag) return false;
    this.raise(flag);
    if (flag === "__mouse_hover_enter") this.blackboard.__mouse_hover_active = true;
    else if (flag === "__mouse_hover_leave") this.blackboard.__mouse_hover_active = false;
    return true;
  }

  dispose(): void {
    this.runExitCleanup();
  }
}
