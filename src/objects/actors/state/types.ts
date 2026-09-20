import type * as THREE from "three";
import type { MutableRefObject } from "react";
import type { AnimationChannel, AnimationSpec } from "./animation";
import type { Input } from "./input";
import type { Motion } from "./motion";

// A config is plain data + functions with NO Three.js at runtime — it runs on the server as-is.

export type TriggerFn = (ctx: TriggerContext) => boolean;

export interface TriggerDef {
  id: string;
  evaluate: TriggerFn;
}

export interface TriggerContext {
  /** Body CENTER for movers. */
  positionRef: MutableRefObject<THREE.Vector3>;
  /** The NEAREST player — no client is special. */
  playerPosition: THREE.Vector3;
  playerDistanceSq: number;
  /** Seconds. */
  delta: number;
  /** Seconds since the machine started. */
  elapsed: number;
  /** Seconds since the current state was entered. */
  stateElapsed: number;
  /** Per-instance memory between ticks. */
  blackboard: Record<string, any>;
  motion: Motion;
  animation: AnimationChannel;
  /** On the server: any player's input; on a client mirror: only THIS player's. */
  input: Input;
}

export type BehaviorFn = (ctx: BehaviorContext) => void;

export interface BehaviorContext extends TriggerContext {
  /** Null on the SERVER — guard every scene access on it. */
  groupRef: MutableRefObject<THREE.Group | null>;
}

/** May return a cleanup, run when the state is left (or the machine disposed). */
export type StateEnterFn = (ctx: BehaviorContext) => void | (() => void);

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
