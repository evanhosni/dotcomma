import type * as THREE from "three";
import type { MutableRefObject } from "react";

/** Animation loop modes as plain numbers (three's LoopOnce/LoopRepeat), so a
 *  state machine config never needs Three at RUNTIME — it also runs in Node. */
export const LOOP_ONCE = 2200;
export const LOOP_REPEAT = 2201;

// ─── Triggers ───

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

// ─── Behaviors ───

export type BehaviorFn = (ctx: BehaviorContext) => void;

export interface BehaviorContext extends TriggerContext {
  /** The model group — null on the SERVER. Guard every scene access on it. */
  groupRef: MutableRefObject<THREE.Group | null>;
}

export type StateEnterFn = (ctx: BehaviorContext) => void | (() => void);

// ─── Animation ───

export interface AnimationCommand {
  clipName: string;
  /** Seconds into the clip to start at (synced entities: server time − clipT0,
   *  so every client plays the clip in phase). Wrapped for looping clips. */
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

// ─── State Machine ───

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
  /** Advance the machine by one step (transition scan + current behavior).
   *  Called by the owner's actor `onFrame` when the hook was created with
   *  `externallyDriven`; otherwise the hook's own useFrame calls it. */
  tick: (state: import("@react-three/fiber").RootState, delta: number) => void;
}
