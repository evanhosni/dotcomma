import type * as THREE from "three";
import type { MutableRefObject } from "react";

/** three's LoopOnce/LoopRepeat as plain numbers — a config must not need Three at runtime (it runs in Node). */
export const LOOP_ONCE = 2200;
export const LOOP_REPEAT = 2201;

export type TriggerFn = (ctx: TriggerContext) => boolean;

export interface TriggerDef {
  id: string;
  evaluate: TriggerFn;
}

export interface TriggerContext {
  positionRef: MutableRefObject<THREE.Vector3>;
  playerPosition: THREE.Vector3;
  playerDistanceSq: number;
  delta: number;
  elapsed: number;
  stateElapsed: number;
  blackboard: Record<string, any>;
}

export type BehaviorFn = (ctx: BehaviorContext) => void;

export interface BehaviorContext extends TriggerContext {
  /** null on the SERVER — guard every scene access on it. */
  groupRef: MutableRefObject<THREE.Group | null>;
}

export type StateEnterFn = (ctx: BehaviorContext) => void | (() => void);

export interface AnimationCommand {
  clipName: string;
  /** Seconds into the clip; wrapped for looping clips. */
  startTime?: number;
  fadeDuration?: number;
  timeScale?: number;
  loop?: THREE.AnimationActionLoopStyles;
  clampWhenFinished?: boolean;
}

export interface AnimationControl {
  pendingCommand: AnimationCommand | null;
  dirty: boolean;
}

export interface TransitionDef {
  trigger: string;
  target: string;
  guard?: (ctx: TriggerContext) => boolean;
}

export interface StateDef {
  id: string;
  animation?: AnimationCommand;
  onEnter?: StateEnterFn;
  onUpdate?: BehaviorFn;
  transitions: TransitionDef[];
}

export interface StateMachineConfig {
  initialState: string;
  states: StateDef[];
  triggers: TriggerDef[];
}

export interface StateMachineHandle {
  readonly currentStateId: string;
  forceTransition: (stateId: string) => void;
  blackboard: Record<string, any>;
  animationControl: AnimationControl;
  tick: (state: import("@react-three/fiber").RootState, delta: number) => void;
}
