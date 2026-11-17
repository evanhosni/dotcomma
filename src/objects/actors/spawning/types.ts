import type * as THREE from "three";
import { ActorAttributes } from "../../types";
import type { SpriteLook } from "../../sprite-lod/types";
import { SPAWN_ONLY_KEYS } from "./enums";

export interface TierRadius {
  renderDistance: number;
  footprint: number;
  /** An explicit drop distance (the actor tier's `despawnDistance`). */
  despawnDistance?: number;
}

/** Every attribute is forwarded to each spawned instance as props, so a
 *  member's knobs live on its descriptor and are overridable per mount. */
export type ActorDescriptor<A extends ActorAttributes = ActorAttributes> = A & {
  id: string;
  component: React.FC<ActorProps<A>>;
  footprint: number;
  density: number;
  clustering: number;
  renderDistance: number;
};

export type AnyActorDescriptor = ActorDescriptor<any>;
export type SpawnOnlyKey = (typeof SPAWN_ONLY_KEYS)[number];

export type ActorProps<A extends ActorAttributes = ActorAttributes> = Omit<A, SpawnOnlyKey> & {
  id: string;
  descriptorId: string;
  coordinates: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  despawnDistance?: number;
  frustumPadding?: number;
  /** Set by the pool, only for a kind with a sprite tier and a member that has a look: the spec's
   *  renderDistance, past which the actor hands off to its sprite (Actor.tsx). */
  spriteHandoffDistance?: number;
  onDestroy: (id: string) => void;
};

/** What objects/actors/spawning/spawn.worker.ts receives (no React component). */
export interface SerializedActorDescriptor
  extends Pick<
    ActorDescriptor,
    | "id"
    | "footprint"
    | "density"
    | "clustering"
    | "renderDistance"
    | "priority"
    | "biomeIds"
    | "heightRange"
    | "slopeRange"
    | "roadDistanceRange"
    | "spacingOverrides"
    | "flattenGround"
    | "feature"
    | "zone"
  > {}

export interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}

/** A member component may carry a load-time PROGRAM WARM-UP (utils/render/index.ts): ActorPool renders
 *  `Warmup` once per distinct `warmupKey(descriptor)` as the domain mounts, so the first instance to
 *  stream in mid-play does not link its shaders in that frame. */
export interface ActorWarmupHooks {
  Warmup?: React.FC<{ descriptor: AnyActorDescriptor }>;
  warmupKey?: (descriptor: AnyActorDescriptor) => string;
  /** Its far look, for kinds with a `spriteLod` (sprite-lod/README.md). */
  spriteLook?: SpriteLook;
}
