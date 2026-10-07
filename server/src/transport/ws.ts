import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer, type PerMessageDeflateOptions } from "ws";
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

/** permessage-deflate, which every browser offers. A frame averages ~150 B, so every frame is compressed
 *  (threshold 0) and the deflate CONTEXT is kept across frames — consecutive snapshots repeat their keys
 *  and ids, which is most of the gain (no_context_takeover sent 79% of raw instead of 26%, at the same CPU). Window 15 /
 *  memLevel 8 is zlib's default: ~256 KB of deflate state per connection, and 26% of raw where window 12
 *  (~144 KB) sent 35%. client_max_window_bits is left to the client: requiring it would refuse a browser
 *  that does not offer it. MEASURED (a recorded stream of 40 walking beebles, ~70 frames per connection per
 *  tick, real tick rate): 55.6 → 14.7 KB/s per connection, for +1.8 ms of main-thread CPU (+2.9 ms in all)
 *  per connection per tick — each frame is its own deflate, threadpool round trip and socket write.
 *  WS_DEFLATE=off turns it off. */
const PER_MESSAGE_DEFLATE: PerMessageDeflateOptions = {
  threshold: 0,
  serverMaxWindowBits: 15,
  zlibDeflateOptions: { memLevel: 8 },
};

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

/** A hello'd session's message, except ping (the transport answers it itself). */
const routeToWorld = (world: World, sessionId: string, msg: Exclude<ClientMessage, { t: "ping" }>): void => {
  switch (msg.t) {
    case "hello":
      return; // duplicate hello → ignore
    case "move":
      world.move(sessionId, msg);
      return;
    case "domain":
      world.changeDomain(sessionId, msg.domain);
      return;
    case "data:patch":
      world.patchPlayerData(sessionId, msg.patch);
      return;
    case "entity:register":
      world.registerEntities(sessionId, msg.entities);
      return;
    case "entity:unregister":
      world.unregisterEntities(sessionId, msg.ids);
      return;
    case "entity:interact":
      world.interactWithEntity(sessionId, msg.id, msg.action);
      return;
  }
};

class SocketOutbox implements Outbox {
  private readonly corked = new Set<Socket>();

  constructor(private readonly bySession: Map<string, Conn>) {}

  send(sessionId: string, msg: ServerMessage): void {
    const c = this.bySession.get(sessionId);
    if (c && c.ws.readyState === WebSocket.OPEN) this.write(c.ws, JSON.stringify(msg));
  }

  sendMany(sessionIds: Iterable<string>, msg: ServerMessage, exceptSessionId?: string): void {
    // Serialize once per broadcast, not once per recipient.
    let payload: string | null = null;
    for (const id of sessionIds) {
      if (id === exceptSessionId) continue;
      const c = this.bySession.get(id);
      if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
      payload ??= JSON.stringify(msg);
      this.write(c.ws, payload);
    }
  }

  /** A tick publishes one small frame per moving entity per registrant (~35 per player in the city),
   *  and with Nagle off each `send` was its own write syscall and TCP packet. The socket is corked on
   *  its first frame and uncorked once the current callback finishes (nextTick — same macrotask, no
   *  added latency), so a tick's frames leave as one write. Frames are unchanged. MEASURED (4 sockets
   *  × 40 frames): 1.3 → 0.16 ms of send time per tick. `_socket` is ws's own (sender.js corks it too;
   *  corks nest). Under permessage-deflate each frame is written from its own compression callback,
   *  after the uncork, so the frames coalesce only with WS_DEFLATE=off. */
  private write(ws: WebSocket, payload: string): void {
    const socket = (ws as unknown as { _socket?: Socket })._socket;
    if (socket && !this.corked.has(socket)) {
      socket.cork();
      if (this.corked.size === 0) process.nextTick(this.uncorkAll);
      this.corked.add(socket);
    }
    ws.send(payload);
  }

  private readonly uncorkAll = (): void => {
    for (const s of this.corked) s.uncork();
    this.corked.clear();
  };
}

export const attachWebSocketTransport = (server: http.Server, physics: PhysicsWorld) => {
  const perMessageDeflate = process.env.WS_DEFLATE === "off" ? false : PER_MESSAGE_DEFLATE;
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate });
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

      if (msg.t === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "pong", t0: msg.t0, serverTime: Date.now() } satisfies ServerMessage));
        }
        return;
      }
      routeToWorld(world, conn.sessionId, msg);
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
