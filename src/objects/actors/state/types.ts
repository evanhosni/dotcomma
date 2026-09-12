import type * as THREE from "three";
import type { MutableRefObject } from "react";
import type { AnimationChannel, AnimationSpec } from "./animation";
import type { Input } from "./input";
import type { Motion } from "./motion";

/**
 * STATE MACHINE TYPES. A config is plain data + functions with NO Three.js at
 * runtime (types only) — it runs on the server as-is. Read runner.ts for the
 * contract; motion.ts and animation.ts for the two output channels.
 */

// ─── Triggers ───

export type TriggerFn = (ctx: TriggerContext) => boolean;

export interface TriggerDef {
  id: string;
  evaluate: TriggerFn;
}

export interface TriggerContext {
  /** The actor's position (body CENTER for movers). */
  positionRef: MutableRefObject<THREE.Vector3>;
  /** The NEAREST player — on the server whoever is closest; no client is special. */
  playerPosition: THREE.Vector3;
  playerDistanceSq: number;
  /** Seconds since the last tick. */
  delta: number;
  /** Seconds since the machine started. */
  elapsed: number;
  /** Seconds since the current state was entered. */
  stateElapsed: number;
  /** Per-instance memory. Anything the behavior needs between ticks goes here. */
  blackboard: Record<string, any>;
  /** OUTPUT: where to go and where to face (motion.ts). */
  motion: Motion;
  /** OUTPUT: what clip to play (animation.ts). */
  animation: AnimationChannel;
  /** INPUT: this tick's mouse flags (input.ts). On the server: any player's;
   *  on a client mirror: only THIS player's — the per-player hook. */
  input: Input;
}

// ─── Behaviors ───

export type BehaviorFn = (ctx: BehaviorContext) => void;

export interface BehaviorContext extends TriggerContext {
  /** The model group — null on the SERVER. Guard every scene access on it. */
  groupRef: MutableRefObject<THREE.Group | null>;
}

/** May return a cleanup, run when the state is left (or the machine disposed). */
export type StateEnterFn = (ctx: BehaviorContext) => void | (() => void);

// ─── State Machine ───

export interface TransitionDef {
  trigger: string;
  target: string;
  guard?: (ctx: TriggerContext) => boolean;
}

export interface StateDef {
  id: string;
  /** Shorthand for `ctx.animation.play(...)` on enter. */
  animation?: AnimationSpec;
  onEnter?: StateEnterFn;
  onUpdate?: BehaviorFn;
  transitions: TransitionDef[];
}

export interface StateMachineConfig {
  initialState: string;
  states: StateDef[];
  triggers: TriggerDef[];
}
