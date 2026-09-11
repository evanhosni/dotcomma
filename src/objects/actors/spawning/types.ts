import type * as THREE from "three";
import { ActorAttributes } from "../../types";

/**
 * ACTOR types — the per-object spawn class of the game-object hierarchy
 * (see objects/types.ts for the class overview and the shared base).
 *
 * Actors (beebles, buildings, …) are objects with their own identity, state,
 * or interaction: each mounts as its own React component through ActorPool's
 * spawn lifecycle. Mass stateless scenery belongs to the other classes — see
 * objects/dressing/ (instanced chunks, no per-object components).
 */

/** A registered actor type: a member's attributes (ModelActorAttributes,
 *  BuildingAttributes, … — each extends ActorAttributes) plus the fields the
 *  spawn system cannot default. EVERY attribute is forwarded to each spawned
 *  instance as props, so a member's knobs are set on its descriptor (and
 *  overridable per mount) without a wrapper component. */
export type ActorDescriptor<A extends ActorAttributes = ActorAttributes> = A & {
  /** Unique key, e.g. "beeble". */
  id: string;
  component: React.FC<ActorProps<A>>;
  footprint: number;
  density: number;
  clustering: number;
  /** Spawn radius: camera distance at which the object mounts (and starts fading). */
  renderDistance: number;
};

/** Type-erased descriptor — what the registry, pool and worker handle. */
export type AnyActorDescriptor = ActorDescriptor<any>;

/** Descriptor attributes the SPAWN SYSTEM consumes and no component reads —
 *  stripped before props reach the instance. ONE list drives both the
 *  ActorProps type (Omit) and the pool's runtime strip, so they can't drift. */
export const SPAWN_ONLY_KEYS = [
  "density",
  "footprint",
  "clustering",
  "priority",
  "spacingOverrides",
  "immediateRadius",
  "biomeIds",
  "heightRange",
  "slopeRange",
  "roadDistanceRange",
  "flattenGround",
  "flattenRadius",
  "flattenSkirt",
] as const;
export type SpawnOnlyKey = (typeof SPAWN_ONLY_KEYS)[number];

/** Props every spawned actor component receives from ActorPool: the
 *  descriptor's attributes minus the spawn-only ones, plus the spawn point
 *  and the pool's radii. */
export type ActorProps<A extends ActorAttributes = ActorAttributes> = Omit<A, SpawnOnlyKey> & {
  id: string;
  /** The descriptor this instance came from ("beeble") — the actor base keys
   *  its synced-entity definition on it. */
  descriptorId: string;
  coordinates: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  despawnDistance?: number;
  frustumPadding?: number;
  onDestroy: (id: string) => void;
};

/** The serializable subset of ActorDescriptor sent to spawn.worker.ts (no
 *  React component). Shared by the client (spawnWorker.ts) and the
 *  worker (type-only import) so the two can't drift. */
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
  > {}

export interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}
