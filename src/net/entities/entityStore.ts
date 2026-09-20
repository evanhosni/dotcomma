import { onServerMessage, send } from "../connection";
import type { EntityRegisterItem, EntityUpdateFields, ServerMessage } from "../protocol";
import { pushSnapshot, type Snapshot } from "./interpolation";

/**
 * Every synced actor this client renders + the server's last published fields
 * (merged). Module state read by the actor base per frame; React subscribes
 * per id for UI-cadence events only. Register/unregister are batched onto the
 * next macrotask (a spawn commit mounts many actors at once).
 */

export interface RemoteFields extends EntityUpdateFields {
  /** performance.now() when x/y/z last arrived. */
  receivedAt: number;
}

export interface ClientEntity {
  id: string;
  kind: string;
  origin: { x: number; y: number; z: number };
  /** null until the server has acknowledged the registration. */
  remote: RemoteFields | null;
  /** Server-time-stamped positional track, oldest first (interpolation.ts). */
  snapshots: Snapshot[];
  listeners: Set<(e: ClientEntity) => void>;
}

const entities = new Map<string, ClientEntity>();

const MAX_PER_MESSAGE = 64; // ~100 bytes per item → ~6KB frames, well under the server cap
/** Consecutive walker updates are ≤ ~0.5u apart (5u/s at 10Hz); a bigger jump is a
 *  server-side relocation (restart, backstop) — logged so a "teleport" report can be attributed. */
const SERVER_RELOCATION_WARN_DIST = 5;
let pendingRegister: EntityRegisterItem[] = [];
let pendingUnregister: string[] = [];
let flushScheduled = false;

const flush = () => {
  flushScheduled = false;
  const reg = pendingRegister;
  const unreg = pendingUnregister;
  pendingRegister = [];
  pendingUnregister = [];
  for (let i = 0; i < unreg.length; i += MAX_PER_MESSAGE) {
    send({ t: "entity:unregister", ids: unreg.slice(i, i + MAX_PER_MESSAGE) });
  }
  for (let i = 0; i < reg.length; i += MAX_PER_MESSAGE) {
    send({ t: "entity:register", entities: reg.slice(i, i + MAX_PER_MESSAGE) });
  }
};

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 0);
};

export const getEntity = (id: string): ClientEntity | undefined => entities.get(id);

export const registerEntity = (item: EntityRegisterItem): ClientEntity => {
  let e = entities.get(item.id);
  if (!e) {
    e = {
      id: item.id,
      kind: item.kind,
      origin: { x: item.x, y: item.y, z: item.z },
      remote: null,
      snapshots: [],
      listeners: new Set(),
    };
    entities.set(item.id, e);
  }
  pendingRegister.push(item);
  scheduleFlush();
  return e;
};

export const unregisterEntity = (id: string): void => {
  if (entities.delete(id)) pendingUnregister.push(id);
  scheduleFlush();
};

export const interactEntity = (id: string, action: string): boolean => send({ t: "entity:interact", id, action });

/** Fires on state / clip / machine-state changes only, never on movement. */
export const subscribeEntity = (id: string, fn: (e: ClientEntity) => void): (() => void) => {
  const e = entities.get(id);
  if (!e) return () => {};
  e.listeners.add(fn);
  return () => {
    e.listeners.delete(fn);
  };
};

const notify = (e: ClientEntity) => e.listeners.forEach((l) => l(e));

const onMessage = (msg: ServerMessage) => {
  switch (msg.t) {
    case "init": {
      // The server forgot us: re-register everything mounted, keeping the last
      // known fields so nothing pops while it answers.
      if (entities.size) console.warn(`[sync] session reset — re-registering ${entities.size} entities (a server restart resets NPCs to spawn)`);
      for (const e of entities.values()) {
        pendingRegister.push({ id: e.id, kind: e.kind, x: e.origin.x, y: e.origin.y, z: e.origin.z });
      }
      if (entities.size) scheduleFlush();
      break;
    }
    case "entity:update": {
      const e = entities.get(msg.id);
      if (!e) break;
      const { t: _t, id: _id, ...fields } = msg;
      const next: RemoteFields = { ...(e.remote ?? { receivedAt: 0 }), ...fields };
      if (fields.x !== undefined || fields.z !== undefined || fields.y !== undefined) {
        const r = e.remote;
        if (r && r.x !== undefined && r.z !== undefined && fields.x !== undefined && fields.z !== undefined) {
          const jump = Math.hypot(fields.x - r.x, fields.z - r.z, (fields.y ?? r.y ?? 0) - (r.y ?? 0));
          if (jump > SERVER_RELOCATION_WARN_DIST) {
            console.warn(`[sync] server moved ${e.id} by ${jump.toFixed(1)}u in one update (${r.x.toFixed(1)},${r.z.toFixed(1)} → ${fields.x.toFixed(1)},${fields.z.toFixed(1)})`);
          }
        }
        next.receivedAt = performance.now();
        // The MERGED pose: an update may carry only the changed axes.
        pushSnapshot(e.snapshots, {
          st: next.st ?? (e.snapshots[e.snapshots.length - 1]?.st ?? 0) + 100,
          x: next.x ?? 0,
          y: next.y ?? 0,
          z: next.z ?? 0,
          ry: next.ry ?? 0,
          vx: next.vx ?? 0,
          vy: next.vy ?? 0,
          vz: next.vz ?? 0,
        });
      }
      e.remote = next;
      if (fields.state !== undefined || fields.clip !== undefined || fields.sm !== undefined) notify(e);
      break;
    }
  }
};

onServerMessage(onMessage);

(window as unknown as { __entities: unknown }).__entities = {
  get size() {
    return entities.size;
  },
  list: () =>
    Array.from(entities.values(), (e) => ({
      id: e.id,
      kind: e.kind,
      sm: e.remote?.sm,
      clip: e.remote?.clip,
      x: e.remote?.x,
      z: e.remote?.z,
    })),
  get: (id: string) => entities.get(id),
};
