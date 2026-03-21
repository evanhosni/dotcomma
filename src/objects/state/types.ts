import * as THREE from "three";

// ─── Triggers ───

export type TriggerFn = (ctx: TriggerContext) => boolean;

export interface TriggerDef {
  id: string;
  evaluate: TriggerFn;
}

export interface TriggerContext {
  positionRef: React.MutableRefObject<THREE.Vector3>;
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
  groupRef: React.MutableRefObject<THREE.Group | null>;
}

export type StateEnterFn = (ctx: BehaviorContext) => void | (() => void);

// ─── Animation ───

export interface AnimationCommand {
  clipName: string;
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
}
