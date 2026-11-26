import * as THREE from "three";
import type { ActorFrameContext } from "../types";
import type { ColliderSpec, MovementKind } from "../spec";
import type { MotionOutput } from "../state/types";

export interface KinematicMoverOptions {
  enabled: boolean;
  collider?: ColliderSpec;
  movement: MovementKind;
  coordinates: THREE.Vector3Tuple;
  /** Body CENTER, written every frame (the state machine reads it). */
  positionRef: React.MutableRefObject<THREE.Vector3>;
  /** The model group (feet at the origin) — placed under the body for LOCAL actors. */
  groupRef: React.RefObject<THREE.Group>;
}

export interface KinematicMover {
  step(delta: number, ctx: ActorFrameContext, motion: MotionOutput, serverDriven: boolean): void;
  /** Whether its capsule collides (not while the body is a ragdoll: its parts would hit it). */
  setSolid(solid: boolean): void;
}

export interface PooledModelClone {
  key: string;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  materials: THREE.Material[];
  skeletons: THREE.Skeleton[];
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  /** Unscaled bind-pose bounding radius; per-instance radius = this × max(scale). */
  baseRadius: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

/** One vertex range of a merged skinned geometry: its SOURCE mesh's bounding sphere, which the
 *  beeble's ascend morph (beeble/animations.ts) inflates that range onto, exactly as it did per mesh. */
export interface MergedSkinnedPart {
  start: number;
  count: number;
  center: [number, number, number];
  radius: number;
}
