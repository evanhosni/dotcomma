import type { MutableRefObject } from "react";
import type { AnimationChannel } from "../../../animation/AnimationChannel";
import type { AnimationSpec, AnimationChannelOptions } from "../../../animation/types";
import type { Input } from "./input";
import type { Motion } from "./motion";
import { MOUSE_ONE_SHOT_FLAGS } from "./enums";
import { RootState } from "@react-three/fiber";
import type { SyncHandle } from "../../../net/entities/types";
import * as THREE from "three";

export interface MotionOutput {
  vx: number;
  vy: number | null;
  vz: number;
  yaw: number;
}

/** THREE.Vector3 on the client, a plain object on the server. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The simulated knobs (server and local alike): they change where the actor actually goes. */
export interface MotionParams {
  /** Multiplies every velocity a behavior asks for. */
  speed: number;
  /** Multiplies every turn step (`turnTo`, `turnToward`). */
  turnSpeed: number;
}

/** An actor's motion knobs, the movement counterpart of AnimationConfig. */
export interface MotionConfig extends Partial<MotionParams> {
  /** Stop-motion: the DRAWN position and yaw update this many times a second; the body moves smoothly. Client-only. */
  frameRate?: number;
  /** Degrees: the DRAWN yaw is rounded to a multiple of it relative to the camera's line of sight, so the
   *  viewer always sees it at an exact step (its real yaw is untouched). Client-only. */
  rotationStep?: number;
}

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
  /** A trigger object (the runner collects it — nothing else to list), or the id of one in
   *  `StateMachineConfig.triggers`. An unknown id throws when the machine is built (outside production). */
  trigger: TriggerDef | string;
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

/** How a machine's built-in ragdoll states behave (state/constants.ts RAGDOLL_STATE). */
export interface RagdollConfig {
  /** The clip the body stands back up into. Default: whatever was playing when it went limp. */
  recoverClip?: string;
  /** How long standing back up takes (the client's blend, the server's recover state). Default DEFAULT_RECOVER_SECONDS. */
  recoverSeconds?: number;
}

/** A push given to one bone's body as the ragdoll starts (world units: mass × u/s). A bone the model lacks
 *  pushes the ragdoll's root. */
export interface RagdollImpulse {
  bone: string;
  x: number;
  y: number;
  z: number;
}

export interface StateMachineConfig {
  initialState: string;
  states: StateDef[];
  ragdoll?: RagdollConfig;
  /** Only for triggers a transition names by id; transitions may hold the trigger objects directly. */
  triggers?: TriggerDef[];
}

export type MouseFlag = (typeof MOUSE_ONE_SHOT_FLAGS)[number];

export interface ResolvedTransition {
  trigger: TriggerDef;
  target: string;
  guard?: TransitionDef["guard"];
}

export interface ConfigMaps {
  stateMap: Map<string, StateDef>;
  /** Per state id, its transitions with the trigger resolved (an unresolvable one is dropped). */
  transitionsOf: Map<string, ResolvedTransition[]>;
  /** Every trigger the machine can fire, listed or collected from its transitions. */
  triggers: TriggerDef[];
}

export interface RunnerOptions {
  animation?: AnimationChannelOptions;
  motion?: Partial<MotionParams>;
}

export interface StateMachineHandle {
  readonly currentStateId: string;
  forceTransition: (stateId: string) => void;
  /** Limp (RAGDOLL_STATE) or back up (RECOVER_STATE); `hold` keeps it in the recover state once up. */
  setRagdoll: (on: boolean, impulse?: RagdollImpulse, hold?: boolean) => void;
  blackboard: Record<string, any>;
  motion: Motion;
  animation: AnimationChannel;
  input: Input;
  /** Called from the owner's actor `onFrame` — never a useFrame of its own. */
  tick: (state: RootState, delta: number, sync: SyncHandle | null) => void;
}

export interface UseMouseEventsOptions {
  /** Farthest ray distance (eye → hit) any input registers from — the actor's `interactReach`. */
  reach: number;
  shouldGrowCursor?: boolean;
  /** Per-instance seed (hash of spawn coords) so batch-mounted actors don't all raycast on the same frame. */
  framePhase?: number;
}

export interface MouseEventsHandle {
  /** `distanceSq` is the actor base's 2D squared distance — a lower bound on the 3D one. */
  tick: (camera: THREE.Camera, distanceSq: number, sync: SyncHandle | null) => void;
}
