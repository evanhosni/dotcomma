import { randomUUID } from "node:crypto";
import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  isDomainId,
  PLAYER_DATA_MAX_BYTES,
  type ClientMessage,
  type EntityRegisterItem,
  type MoveIntent,
  type ServerMessage,
} from "../../../src/net/protocol";
import type { PhysicsWorld } from "../game/physics/physicsWorld.js";
import { World, type Outbox } from "../game/world.js";

/**
 * Owns the sockets and nothing about the game: validates frame shapes, forwards to the
 * World, implements its Outbox. HEARTBEAT is not optional: a vanished peer (lid closed,
 * wifi dropped) often never fires `close`; a socket that hasn't ponged by the next sweep
 * is terminated, which DOES fire `close` and removes the ghost.
 */

const HEARTBEAT_MS = 30_000;
const MAX_PAYLOAD_BYTES = 64 * 1024; // a 64-actor registration batch is ~6KB; headroom for state blobs
const MAX_ENTITIES_PER_MESSAGE = 256;
const MAX_ID_LENGTH = 128;

interface Conn {
  ws: WebSocket;
  /** null until `hello` is accepted. */
  sessionId: string | null;
  isAlive: boolean;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const parseRegisterItems = (raw: unknown): EntityRegisterItem[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ENTITIES_PER_MESSAGE) return null;
  const out: EntityRegisterItem[] = [];
  for (const it of raw) {
    if (typeof it !== "object" || it === null) return null;
    const { id, kind, x, y, z } = it as Record<string, unknown>;
    if (!isId(id) || !isId(kind) || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
    out.push({ id, kind, x, y, z });
  }
  return out;
};

const parseMove = (raw: Record<string, unknown>): MoveIntent | null => {
  const { x, y, z, vx, vy, vz, ry } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!isFiniteNumber(vx) || !isFiniteNumber(vy) || !isFiniteNumber(vz) || !isFiniteNumber(ry)) return null;
  return { x, y, z, vx, vy, vz, ry };
};

/** Anything odd → null → ignored. */
const parseClientMessage = (data: unknown): ClientMessage | null => {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  switch (raw.t) {
    case "hello":
      if (typeof raw.identity !== "string" || raw.identity.length === 0 || raw.identity.length > 64) return null;
      if (!isDomainId(raw.domain)) return null;
      return { t: "hello", identity: raw.identity, domain: raw.domain };
    case "move": {
      const m = parseMove(raw);
      return m ? { t: "move", ...m } : null;
    }
    case "domain":
      return isDomainId(raw.domain) ? { t: "domain", domain: raw.domain } : null;
    case "ping":
      return isFiniteNumber(raw.t0) ? { t: "ping", t0: raw.t0 } : null;
    case "data:patch": {
      const patch = raw.patch;
      if (!isPlainObject(patch) || JSON.stringify(patch).length > PLAYER_DATA_MAX_BYTES) return null;
      return { t: "data:patch", patch };
    }
    case "entity:register": {
      const entities = parseRegisterItems(raw.entities);
      return entities ? { t: "entity:register", entities } : null;
    }
    case "entity:unregister": {
      const ids = raw.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ENTITIES_PER_MESSAGE || !ids.every(isId)) return null;
      return { t: "entity:unregister", ids: ids as string[] };
    }
    case "entity:interact":
      return isId(raw.id) && isId(raw.action) ? { t: "entity:interact", id: raw.id, action: raw.action } : null;
    default:
      return null;
  }
};

class SocketOutbox implements Outbox {
  constructor(private readonly bySession: Map<string, Conn>) {}

  send(sessionId: string, msg: ServerMessage): void {
    const c = this.bySession.get(sessionId);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }

  sendMany(sessionIds: Iterable<string>, msg: ServerMessage, exceptSessionId?: string): void {
    // Serialize once per broadcast, not once per recipient.
    let payload: string | null = null;
    for (const id of sessionIds) {
      if (id === exceptSessionId) continue;
      const c = this.bySession.get(id);
      if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
      payload ??= JSON.stringify(msg);
      c.ws.send(payload);
    }
  }
}

export const attachWebSocketTransport = (server: http.Server, physics: PhysicsWorld) => {
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });
  const bySession = new Map<string, Conn>();
  const all = new Set<Conn>(); // hello'd or not — for the heartbeat sweep
  const world = new World(new SocketOutbox(bySession), physics);

  wss.on("connection", (ws) => {
    const conn: Conn = { ws, sessionId: null, isAlive: true };
    all.add(conn);

    ws.on("pong", () => {
      conn.isAlive = true;
    });

    ws.on("message", (buf, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.toString());
      } catch {
        return; // malformed → ignore
      }
      const msg = parseClientMessage(parsed);
      if (!msg) return;

      if (conn.sessionId === null) {
        if (msg.t !== "hello") return;
        const id = randomUUID();
        conn.sessionId = id;
        bySession.set(id, conn);
        world.addSession(id, msg.identity, msg.domain);
        console.log(`[ws] + ${id.slice(0, 8)} (${msg.identity.slice(0, 8)}) → ${msg.domain}  [${world.size} online]`);
        return;
      }

      switch (msg.t) {
        case "hello":
          return; // duplicate hello → ignore
        case "move":
          world.move(conn.sessionId, msg);
          return;
        case "domain":
          world.changeDomain(conn.sessionId, msg.domain);
          return;
        case "ping":
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: "pong", t0: msg.t0, serverTime: Date.now() } satisfies ServerMessage));
          }
          return;
        case "data:patch":
          world.patchPlayerData(conn.sessionId, msg.patch);
          return;
        case "entity:register": {
          const s = world.get(conn.sessionId);
          if (s) world.entities.register(conn.sessionId, s.domain, msg.entities);
          return;
        }
        case "entity:unregister":
          world.entities.unregister(conn.sessionId, msg.ids);
          return;
        case "entity:interact": {
          const s = world.get(conn.sessionId);
          if (s) world.entities.interact(conn.sessionId, msg.id, msg.action, world.entities.playersFor(s.domain));
          return;
        }
      }
    });

    const drop = () => {
      all.delete(conn);
      if (conn.sessionId === null) return;
      const id = conn.sessionId;
      conn.sessionId = null;
      bySession.delete(id);
      world.removeSession(id);
      console.log(`[ws] - ${id.slice(0, 8)}  [${world.size} online]`);
    };
    ws.on("close", drop);
    ws.on("error", (err) => {
      console.warn("[ws] socket error:", err.message);
      drop();
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of all) {
      if (!conn.isAlive) {
        conn.ws.terminate(); // fires 'close' → drop()
        continue;
      }
      conn.isAlive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  return { wss, world };
};
