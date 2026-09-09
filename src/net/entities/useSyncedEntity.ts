import { useEffect, useMemo } from "react";
import { getEntity, interactEntity, registerEntity, subscribeEntity, unregisterEntity, type ClientEntity } from "./entityStore";

/**
 * THE sync handle an actor gets on `ctx.sync` (created by the actor base,
 * objects/actors/Actor.tsx — no component creates one itself).
 *
 * The SERVER is the authority for every synced actor. On the client:
 *   - the base computes `target` every frame from the server's last update
 *     (position + velocity extrapolation) and, unless a mover owns the body,
 *     places the group there; it eases yaw toward the server's;
 *   - ModelActor's kinematic mover chases `target` with the server's velocity
 *     fed forward, so terrain and collisions stay local;
 *   - ModelActor plays the server's clip in phase; useStateMachine MIRRORS the
 *     server's state id so state-keyed visuals run;
 *   - inputs go to the server with interact() (useMouseEvents forwards clicks;
 *     components send their own actions, e.g. "door:2") and come back as
 *     replicated `state` or as the machine's reaction.
 *
 * `known` is false until the server has acknowledged the registration; until
 * then the actor sits at its spawn point.
 */

export interface PuppetTarget {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  ry: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SyncHandle {
  readonly id: string;
  readonly entity: ClientEntity | undefined;
  /** Server has acknowledged this entity (we have its fields). */
  readonly known: boolean;
  /** Placement target this frame (written by the base, read by movers). */
  readonly target: PuppetTarget;
  /** Set by a mover that owns the body: the base then leaves position alone. */
  bodyManaged: boolean;
  /** Replicated state blob (server-owned; toggled via interact()). */
  readonly state: Record<string, unknown> | undefined;
  /** The server-side machine's current state id (for mirrored visuals). */
  readonly stateId: string | undefined;
  /** Send an input to the server. */
  interact(action: string): void;
  /** UI-cadence: state / clip / machine-state changes. */
  subscribe(fn: (e: ClientEntity) => void): () => void;
}

export const useSyncedEntity = (
  instanceId: string | null,
  kind: string,
  origin: readonly [number, number, number],
): SyncHandle | null => {
  const [ox, oy, oz] = origin;

  const handle = useMemo<SyncHandle | null>(() => {
    if (instanceId === null) return null;
    const id = instanceId;
    const target: PuppetTarget = { valid: false, x: ox, y: oy, z: oz, ry: 0, vx: 0, vy: 0, vz: 0 };
    return {
      id,
      target,
      bodyManaged: false,
      get entity() {
        return getEntity(id);
      },
      get known() {
        return getEntity(id)?.remote !== null && getEntity(id) !== undefined;
      },
      get state() {
        return getEntity(id)?.remote?.state;
      },
      get stateId() {
        return getEntity(id)?.remote?.sm;
      },
      interact(action) {
        interactEntity(id, action);
      },
      subscribe: (fn) => subscribeEntity(id, fn),
    };
  }, [instanceId, ox, oy, oz]);

  useEffect(() => {
    if (instanceId === null) return;
    registerEntity({ id: instanceId, kind, x: ox, y: oy, z: oz });
    return () => unregisterEntity(instanceId);
  }, [instanceId, kind, ox, oy, oz]);

  return handle;
};
