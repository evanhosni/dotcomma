import { AnimationChannel } from "./animation";
import { Input } from "./input";
import { Motion, type Vec3Like } from "./motion";
import type { BehaviorContext, StateDef, StateMachineConfig, TriggerDef } from "./types";

export type { Vec3Like };

/**
 * STATE MACHINE RUNNER — the Three-free core of an actor's behavior.
 *
 * The same runner (and the same StateMachineConfig files, e.g.
 * beeble/stateMachine.ts) executes in TWO places:
 *   - on the SERVER (server/src/game/entities/manager.ts), which is the ONE
 *     authority for every synced actor: it ticks transitions and behaviors,
 *     reads the machine's OUTPUTS (`motion`, `animation`) and publishes them;
 *   - on the CLIENT (useStateMachine.ts): for `serverSynced={false}` actors it
 *     ticks exactly like the server; for synced actors it MIRRORS the server's
 *     state id (entering states as the server does) so that state-keyed
 *     VISUALS — head tracking, the sphere-inflate — run where there is a scene,
 *     while every output is ignored in favor of the server's.
 *
 * THE CONTRACT for a StateMachineConfig, which is what makes this possible:
 *   - behaviors express movement through `ctx.motion` (move / heading /
 *     toward / fly / stop / face / turnToward …) and animation through
 *     `ctx.animation` (play / pause / resume / stop / setSpeed) or the state's
 *     `animation` shorthand — and never touch the scene for those. The
 *     framework applies them (kinematic mover, actor base, ModelActor).
 *   - anything that needs the scene (bones, geometry, materials) must guard on
 *     `ctx.groupRef.current` being present: it is null on the server.
 *   - no Three.js at RUNTIME in a config file (types only, via `import type`);
 *     Node has no scene.
 *   - `Math.random` is fine: the server is the single source of truth.
 */

// One-shot mouse flags written by useMouseEvents (client) or raised by the
// server from a forwarded input. Cleared each tick something was raised.
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

/** The wire ACTION name of a mouse flag: `__mouse_hover_enter` → `mouse-hover-enter`.
 *  Every mouse INPUT the client's raycast detects is forwarded to the server
 *  under this name (useMouseEvents) and raised there (`raiseMouseAction`) —
 *  inputs cross the wire, never triggers: the server's machine evaluates its
 *  own triggers against its own flags. */
export const mouseActionOf = (flag: MouseFlag): string => flag.slice(2).replace(/_/g, "-");
const FLAG_BY_ACTION = new Map<string, MouseFlag>(MOUSE_ONE_SHOT_FLAGS.map((f) => [mouseActionOf(f), f]));
export const mouseFlagOf = (action: string): MouseFlag | undefined => FLAG_BY_ACTION.get(action);

// State/trigger lookup maps are pure functions of the (module-constant)
// config — build them once per config, not once per instance.
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
  /** ONE context object per instance, fields mutated per tick — no allocation. */
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

  /**
   * AUTHORITATIVE step: transitions, then the current behavior.
   * `elapsed`/`delta` in seconds; `clockMs` is the animation clock (server
   * time on the server, the local frame clock on a local actor).
   */
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

  /** FOLLOWER step (synced client): adopt the server's state id — running
   *  onEnter/cleanup exactly as the server did — and run the behavior for its
   *  visual side effects. Outputs written meanwhile are ignored by the
   *  framework in favor of the server's (the caller injects those first). */
  mirror(stateId: string, elapsed: number, delta: number, clockMs: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
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

  /** Raise a one-shot flag (the client's raycast, or a forwarded input on the server). */
  raise(flag: string): void {
    this.blackboard[flag] = true;
    this.blackboard.__mouse_dirty = true;
  }

  /** Raise the flag a forwarded mouse ACTION names; false if it isn't one.
   *  Hover also keeps the level `__mouse_hover_active` in step. */
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
