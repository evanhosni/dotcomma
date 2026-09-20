import type * as THREE from "three";
import { ActorAttributes } from "../../types";

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

/** Consumed by the spawn system only. ONE list drives both the ActorProps
 *  Omit and the pool's runtime strip, so they can't drift. */
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

export type ActorProps<A extends ActorAttributes = ActorAttributes> = Omit<A, SpawnOnlyKey> & {
  id: string;
  descriptorId: string;
  coordinates: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  despawnDistance?: number;
  frustumPadding?: number;
  onDestroy: (id: string) => void;
};

/** What spawn.worker.ts receives (no React component). */
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
