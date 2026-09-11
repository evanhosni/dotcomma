import { onServerMessage, send } from "../connection";
import type { EntityRegisterItem, EntityUpdateFields, ServerMessage } from "../protocol";
import { pushSnapshot, type Snapshot } from "./interpolation";

/**
 * Client ENTITY STORE — every synced actor this client is rendering and the
 * SERVER's last published fields for it (merged). The server is the only
 * authority; this client, like every other, is a puppet. Plain module state
 * read by the actor base every frame; React-facing code subscribes per id for
 * the UI-cadence events (replicated state, clip, machine state id).
 *
 * Registration is batched: a spawn commit mounts many actors at once, so
 * register/unregister calls are collected and sent as one message on the
 * next macrotask. After every `init` (connect, reconnect, domain switch) the
 * whole live set is re-registered — the server forgot us.
 */

export interface RemoteFields extends EntityUpdateFields {
  /** performance.now() when x/y/z last arrived (extrapolation base). */
  at: number;
}

export interface ClientEntity {
  id: string;
  kind: string;
  origin: { x: number; y: number; z: number };
  /** Merged fields as last received from the server; null until acknowledged. */
  remote: RemoteFields | null;
  /** The published TRACK: every positional update as a server-time-stamped
   *  snapshot, oldest first (interpolation.ts — the actor base samples it). */
  snapshots: Snapshot[];
  listeners: Set<(e: ClientEntity) => void>;
}

const entities = new Map<string, ClientEntity>();

// ── batching ───────────────────────────────────────────────────────────────

const MAX_PER_MESSAGE = 64; // ~100 bytes per item → ~6KB frames, well under the server cap
/** A single update moving an entity farther than this is a server-side relocation (see onMessage). */
const SERVER_JUMP_WARN = 5;
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

// ── public API ─────────────────────────────────────────────────────────────

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

/** Client → server: an input on this entity ("mouse-left-click", "door:2"). */
export const interactEntity = (id: string, action: string): boolean => send({ t: "entity:interact", id, action });

/** UI-cadence subscription: state blob, clip, machine state id. */
export const subscribeEntity = (id: string, fn: (e: ClientEntity) => void): (() => void) => {
  const e = entities.get(id);
  if (!e) return () => {};
  e.listeners.add(fn);
  return () => {
    e.listeners.delete(fn);
  };
};

const notify = (e: ClientEntity) => e.listeners.forEach((l) => l(e));

// ── wire → store ───────────────────────────────────────────────────────────

const onMessage = (msg: ServerMessage) => {
  switch (msg.t) {
    case "init": {
      // Fresh session: re-register everything still mounted (last known
      // fields are kept so nothing pops while the server answers). If the
      // SERVER restarted, its answers put every NPC back at its spawn point —
      // a mass teleport that is a dev-loop artifact (tsx watch), not sync.
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
      const next: RemoteFields = { ...(e.remote ?? { at: 0 }), ...fields };
      if (fields.x !== undefined || fields.z !== undefined || fields.y !== undefined) {
        // Diagnostic: the SERVER's own track jumped. Consecutive updates of a
        // walker are ≤ ~0.5u apart (5u/s at 10Hz); anything larger is a
        // server-side relocation (restart → spawn, backstop/stuck lift), never
        // client rendering. Lets a "beeble teleported" report be attributed.
        const r = e.remote;
        if (r && r.x !== undefined && r.z !== undefined && fields.x !== undefined && fields.z !== undefined) {
          const jump = Math.hypot(fields.x - r.x, fields.z - r.z, (fields.y ?? r.y ?? 0) - (r.y ?? 0));
          if (jump > SERVER_JUMP_WARN) {
            console.warn(`[sync] server moved ${e.id} by ${jump.toFixed(1)}u in one update (${r.x.toFixed(1)},${r.z.toFixed(1)} → ${fields.x.toFixed(1)},${fields.z.toFixed(1)})`);
          }
        }
        next.at = performance.now();
        // Snapshot for interpolation: the tick's server time with the MERGED
        // pose (an update may carry only the changed axes).
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
      // Transforms are consumed by the frame loop; only UI-relevant fields notify.
      if (fields.state !== undefined || fields.clip !== undefined || fields.sm !== undefined) notify(e);
      break;
    }
  }
};

onServerMessage(onMessage);

// Console access: __entities.size, __entities.list(), __entities.get(id)
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
