import type * as THREE from "three";
import type { RagdollPhase } from "../ragdoll/types";
import type { RagdollImpulse } from "../state/types";

/** A mounted model actor as code outside it reaches it, by its spawn id (the intro's host beeble, the MAV
 *  Unit screwing into its head). */
export interface LiveModelActor {
  readonly id: string;
  /** Its model (the pooled clone's root): the bones are under it. */
  readonly model: THREE.Object3D;
  readonly group: THREE.Group | null;
  /** The server knows it: it can be shot (weapons/), its wounds and death are the server's. */
  readonly synced: boolean;
  /** Where its body is now: its centre, or where its ragdoll lies (a corpse falls away from where it stood). */
  bodyCenter(out: THREE.Vector3): THREE.Vector3;
  /** Limp, or back up. A synced actor's limp is PREDICTED here until the server's state arrives (or a few
   *  seconds pass without it); getting up is the server's alone. A local actor's machine does both. */
  setRagdoll(on: boolean, impulse?: RagdollImpulse, hold?: boolean): void;
  /** Shoves its limp body, as each client simulates it (a shot at a corpse); nothing while it stands. */
  push(impulse: RagdollImpulse): void;
  readonly ragdollPhase: RagdollPhase;
  /** Its real facing (rotation.y): the server's for a synced actor. The group's is the DRAWN one, stepped to
   *  each viewer's camera (MotionConfig.rotationStep). */
  readonly yaw: number;
  /** Whether this client draws it (not while the camera is inside its head). */
  setDrawn(drawn: boolean): void;
}

const live = new Map<string, LiveModelActor>();

/** Returns the unregister. */
export const registerLiveModelActor = (actor: LiveModelActor): (() => void) => {
  live.set(actor.id, actor);
  return () => {
    if (live.get(actor.id) === actor) live.delete(actor.id);
  };
};

export const getLiveModelActor = (id: string): LiveModelActor | undefined => live.get(id);

export const liveModelActors = (): IterableIterator<LiveModelActor> => live.values();
