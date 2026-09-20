import type { AnimationControl, BehaviorContext, StateDef, StateMachineConfig, TriggerDef } from "./types";

/**
 * Three-free state machine core, run by the SERVER (the authority) and by the
 * client (ticking for local actors, MIRRORING the server's state id for synced
 * ones so state-keyed visuals still happen). See NPC_TRACKING.md.
 *
 * THE CONTRACT for a StateMachineConfig:
 *   - OUTPUTS go to the blackboard — `__vel_x/_z` (`__vel_y`, undefined =
 *     gravity), `__yaw`, animation via `state.animation` — never to the scene;
 *   - anything scene-bound guards on `ctx.groupRef.current` (null on the server);
 *   - no Three at RUNTIME (`import type` only; loop modes from types.ts);
 *   - `Math.random` is fine: the server is the single source of truth.
 */

/** THREE.Vector3 on the client, a plain object on the server. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const MOUSE_ONE_SHOT_FLAGS = [
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
  readonly animationControl: AnimationControl = { pendingCommand: null, dirty: false };
  private readonly stateMap: Map<string, StateDef>;
  private readonly triggerMap: Map<string, TriggerDef>;
  private stateId: string;
  private stateEnteredAt = 0;
  private exitCleanup: (() => void) | null = null;
  private entered = false;
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
    this.ctx = {
      positionRef: positionRef as BehaviorContext["positionRef"],
      playerPosition: positionRef.current as BehaviorContext["playerPosition"],
      playerDistanceSq: Infinity,
      delta: 0,
      elapsed: 0,
      stateElapsed: 0,
      blackboard: this.blackboard,
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
      this.animationControl.pendingCommand = state.animation;
      this.animationControl.dirty = true;
    }
    if (state.onEnter) {
      const cleanup = state.onEnter(this.ctx);
      if (typeof cleanup === "function") this.exitCleanup = cleanup;
    }
  }

  private prepare(elapsed: number, delta: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    const c = this.ctx;
    c.playerPosition = playerPosition as BehaviorContext["playerPosition"];
    c.playerDistanceSq = playerDistanceSq;
    c.delta = delta;
    c.elapsed = elapsed;
    c.stateElapsed = elapsed - this.stateEnteredAt;
  }

  /** AUTHORITATIVE step. */
  tick(elapsed: number, delta: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    this.prepare(elapsed, delta, playerPosition, playerDistanceSq);
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

  /** FOLLOWER step: adopt the server's state id (onEnter/cleanup run as the
   *  server's did) and run the behavior for its visual side effects only. */
  followServerState(stateId: string, elapsed: number, delta: number, playerPosition: Vec3Like, playerDistanceSq: number): void {
    this.prepare(elapsed, delta, playerPosition, playerDistanceSq);
    if (!this.entered || this.stateId !== stateId) {
      this.entered = true;
      this.enterState(stateId, elapsed);
      this.animationControl.pendingCommand = null;
      this.animationControl.dirty = false;
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

  dispose(): void {
    if (this.exitCleanup) {
      this.exitCleanup();
      this.exitCleanup = null;
    }
  }
}
