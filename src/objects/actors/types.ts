import { RootState } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import type { SyncHandle } from "../../net/entities/types";
import type { MotionOutput, StateMachineHandle } from "./state/types";

// ONE frame subscriber for every mounted actor (driven by ActorPool's useFrame):
// per-instance useFrames were hundreds of subscribers plus churn per spawn batch.
export type ActorFrameUpdater = (state: RootState, delta: number) => void;

export interface ActorLifecycleOptions {
  id: string;
  /** The server picks the simulation by it. */
  descriptorId?: string;
  /** Default true. False = purely local, never registered. */
  serverSynced?: boolean;
  coordinates: THREE.Vector3Tuple;
  /** Live position for actors that move. Falls back to coordinates. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  renderDistance?: number;
  /** Default renderDistance × DESPAWN_DISTANCE_FACTOR. */
  despawnDistance?: number;
  onDestroy: (id: string) => void;
  /** Frames between gate evaluations (fade and kill run every frame). Default 1. */
  checkInterval?: number;
  /** Dither OUT past renderDistance (then self-destroy) instead of popping at despawnDistance. Every
   *  actor dithers IN when its group first appears (vfx/spawn-fade/index.ts). */
  fadeOut?: boolean;
  /** A kind with a sprite tier (sprite-lod/README.md): past this distance the actor spawn-fades out and is held
   *  hidden while its sprite draws the pixels it gives up; back inside it fades in again. Not with `fadeOut`. */
  spriteHandoffDistance?: number;
  /** Omit to skip the frustum test (meshes that cull themselves). */
  boundsRadius?: number;
  frustumPadding?: number;
  /** Frames held visible after mount so the uploadOnFirstDraw warm draw can happen. Default 3. */
  forceVisibleFrames?: number;
  colliderDistance?: number;
  /** Extra distance retained once a gate is active, so it can't flicker. */
  gateHysteresis?: number;
  throttleColliderActivation?: boolean;
  /** Distance inside which dynamic content (children, interiors, doors) is live. */
  nearDistance?: number;
  /** MotionConfig.rotationStep: degrees the DRAWN yaw is stepped by, relative to the camera's line of sight. */
  rotationStep?: number;
  /** MotionConfig.frameRate: the drawn position and yaw are held between this grid's ticks. */
  motionFrameRate?: number;
  /** Static actors: freeze the matrix subtree, unfreeze inside nearDistance. */
  freezeMatrices?: boolean;
  /** Per-frame work inside the shared driver — never a useFrame of your own. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
}

export interface ActorFrameContext {
  /** 2D squared camera distance — the one the gates used this frame. */
  distanceSq: number;
  /** Null when serverSynced={false}. */
  sync: SyncHandle | null;
  /** The delayed server time this frame is drawn at; NaN while unsynced. Anything
   *  keyed to the server clock (clip switches) applies against this. */
  syncRenderTime: number;
  machine?: StateMachineHandle | null;
  /** The motion output the kinematic mover resolves this frame. */
  motion?: MotionOutput;
  /** True on frames where the throttled gate checks ran. */
  gatesChecked: boolean;
  /** This frame's frustum result (true when the test is disabled). */
  visible: boolean;
  /** Spawn-fade visibility, 0..1 — for parts drawn outside the group (a building's far doors). */
  spawnFade: number;
}

export interface ActorLifecycle {
  /** Attach to the actor's root <group>: visibility and matrix freezing are written through it. */
  groupRef: React.RefObject<THREE.Group>;
  collidersActive: boolean;
  nearActive: boolean;
  distanceSqRef: React.MutableRefObject<number>;
  destroyedRef: React.MutableRefObject<boolean>;
  sync: SyncHandle | null;
  /** Re-arm for a fresh life: fades in again. */
  resetLife: () => void;
}
