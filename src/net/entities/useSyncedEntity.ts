import { useEffect, useMemo } from "react";
import { getEntity, interactEntity, registerEntity, subscribeEntity, unregisterEntity, type ClientEntity } from "./entityStore";

/**
 * The sync handle on `ctx.sync`, created only by the actor base (Actor.tsx).
 * The actor base writes `target` each frame from snapshot interpolation; movers
 * and visuals read it. See CLAUDE.md → Entity sync.
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
  /** False until the server has acknowledged the registration (the actor sits at spawn). */
  readonly known: boolean;
  readonly target: PuppetTarget;
  /** Server-owned; toggled via interact(). */
  readonly state: Record<string, unknown> | undefined;
  /** The server-side machine's current state id. */
  readonly stateId: string | undefined;
  interact(action: string): void;
  /** Fires on state / clip / machine-state changes only. */
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
