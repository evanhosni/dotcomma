import type * as THREE from "three";
import type { Cut, Vec3Tuple, Wound } from "../../net/protocol/types";
import type { RagdollImpulse } from "../../objects/actors/state/types";

/** A dead player's corpse lying on this client, as a shot reaches it (weapons/). */
export interface LiveCorpse {
  readonly id: string;
  readonly meshes: readonly THREE.SkinnedMesh[];
  /** Where its body lies now (its ragdoll's root). */
  center(out: THREE.Vector3): THREE.Vector3;
  /** A shot's new holes, kept with the ones it died with. */
  wound(wounds: readonly Wound[]): void;
  push(impulse: RagdollImpulse): void;
  /** A blade's cuts, or a blast's burst from `gib` (objects/actors/slices/). */
  strike(blow: { cuts?: Cut[]; gib?: Vec3Tuple }): void;
}

const live = new Map<string, LiveCorpse>();

/** Returns the unregister. */
export const registerCorpse = (corpse: LiveCorpse): (() => void) => {
  live.set(corpse.id, corpse);
  return () => {
    if (live.get(corpse.id) === corpse) live.delete(corpse.id);
  };
};

export const getCorpse = (id: string): LiveCorpse | undefined => live.get(id);

export const liveCorpses = (): IterableIterator<LiveCorpse> => live.values();
