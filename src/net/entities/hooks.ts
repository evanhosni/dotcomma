/**
 * The sync handle on `ctx.sync`, created only by the actor base (Actor.tsx).
 * The actor base writes `target` each frame from snapshot interpolation; movers
 * and visuals read it. See CLAUDE.md → Entity sync.
 */
import { useEffect, useMemo } from "react";
import { getEntity, interactEntity, registerEntity, subscribeEntity, unregisterEntity } from "./store";
import type { SyncHandle, PuppetTarget } from "./types";

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
        const e = getEntity(id);
        return e !== undefined && e.remote !== null;
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
