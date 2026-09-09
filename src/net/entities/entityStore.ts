import { onServerMessage, send } from "../connection";
import type { EntityRegisterItem, EntityUpdateFields, ServerMessage } from "../protocol";

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
  listeners: Set<(e: ClientEntity) => void>;
}

const entities = new Map<string, ClientEntity>();

// ── batching ───────────────────────────────────────────────────────────────

const MAX_PER_MESSAGE = 64; // ~100 bytes per item → ~6KB frames, well under the server cap
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
      // fields are kept so nothing pops while the server answers).
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
      if (fields.x !== undefined || fields.z !== undefined || fields.y !== undefined) next.at = performance.now();
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
