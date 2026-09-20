import { AnimationChannel } from "./animation";
import { Input } from "./input";
import { Motion, type Vec3Like } from "./motion";
import type { BehaviorContext, StateDef, StateMachineConfig, TriggerDef } from "./types";

export type { Vec3Like };

/**
 * The Three-free state machine core. The SAME config file runs on the server
 * (the one authority; its `motion`/`animation` outputs are published) and on
 * the client (local actors tick; synced actors follow the server's state id so
 * state-keyed visuals run). THE AUTHORING CONTRACT: movement through
 * `ctx.motion`, animation through `ctx.animation` — never the scene; anything
 * scene-bound guards on `ctx.groupRef.current` (null on the server); no Three at
 * runtime in a config (`import type`); `Math.random` is fine.
 */

/** One-shot flags written by useMouseEvents (client) or raised from a forwarded input (server). */
export const MOUSE_ONE_SHOT_FLAGS = [
  "__mouse_hover_enter",
  "__mouse_hover_leave",
  "__mouse_left_click",
  "__mouse_right_click",
  "__mouse_left_click_down",
  "__mouse_right_click_down",
  "__mouse_left_click_up",
  "__mouse_right_click_up",
  "__mouse_scroll",
  "__mouse_scroll_up",
  "__mouse_scroll_down",
  "__mouse_double_click",
  "__mouse_middle_click",
] as const;
export type MouseFlag = (typeof MOUSE_ONE_SHOT_FLAGS)[number];

/** `__mouse_hover_enter` → `mouse-hover-enter`, the wire action name. */
export const mouseActionOf = (flag: MouseFlag): string => flag.slice(2).replace(/_/g, "-");
const FLAG_BY_ACTION = new Map<string, MouseFlag>(MOUSE_ONE_SHOT_FLAGS.map((f) => [mouseActionOf(f), f]));
export const mouseFlagOf = (action: string): MouseFlag | undefined => FLAG_BY_ACTION.get(action);

// Lookup maps are pure functions of the module-constant config — once per config, not per instance.
const configMapsCache = new WeakMap<
  StateMachineConfig,
  { stateMap: Map<string, StateDef>; triggerMap: Map<string, TriggerDef> }
>();
const getConfigMaps = (config: StateMachineConfig) => {
  let maps = configMapsCache.get(config);
  if (!maps) {
    const stateMap = new Map<string, StateDef>();
    for (const s of config.states) stateMap.set(s.id, s);
    const triggerMap = new Map<string, TriggerDef>();
    for (const t of config.triggers) triggerMap.set(t.id, t);
    maps = { stateMap, triggerMap };
    configMapsCache.set(config, maps);
  }
  return maps;
};

export class StateMachineRunner {
  readonly blackboard: Record<string, any> = {};
  readonly motion: Motion;
  readonly animation = new AnimationChannel();
  readonly input = new Input(this.blackboard);
  private readonly stateMap: Map<string, StateDef>;
  private readonly triggerMap: Map<string, TriggerDef>;
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
  ) {
    const maps = getConfigMaps(config);
    this.stateMap = maps.stateMap;
    this.triggerMap = maps.triggerMap;
    this.stateId = config.initialState;
    this.motion = new Motion(positionRef);
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

  private enterState(stateId: string, elapsed: number): void {
    if (this.exitCleanup) {
      this.exitCleanup();
      this.exitCleanup = null;
    }
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
      this.enterState(forced, elapsed);
      this.stateMap.get(this.stateId)?.onUpdate?.(this.ctx);
      return;
    }

    const current = this.stateMap.get(this.stateId);
    if (!current) return;

    for (const transition of current.transitions) {
      const trigger = this.triggerMap.get(transition.trigger);
      if (!trigger) continue;
      if (trigger.evaluate(this.ctx)) {
        if (transition.guard && !transition.guard(this.ctx)) continue;
        this.enterState(transition.target, elapsed);
        this.stateMap.get(this.stateId)?.onUpdate?.(this.ctx);
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
    if (this.exitCleanup) {
      this.exitCleanup();
      this.exitCleanup = null;
    }
  }
}
