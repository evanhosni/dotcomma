import express from "express";
import type { Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../../../src/net/protocol/types";
import type { PhysicsWorld } from "../game/physics/physicsWorld.js";
import { World } from "../game/world.js";
import type { Outbox } from "../game/types.js";
import { PER_MESSAGE_DEFLATE, MAX_PAYLOAD_BYTES, HEARTBEAT_MS } from "./constants";
import { parseClientMessage } from "./utils";

// Relative to this file: server/dist (prod) and server/src (tsx dev) are both one
// level below server/, and the client build is at <repo>/build.
const CLIENT_BUILD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../build");

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export const createApp = (): Express => {
  const app = express();
  app.disable("x-powered-by");

  if (!existsSync(path.join(CLIENT_BUILD_DIR, "index.html"))) {
    console.warn(`[http] no client build at ${CLIENT_BUILD_DIR} — run \`npm run build\` at the repo root`);
  }

  // build/static is content-hashed → immutable. index.html is NOT, and a cached
  // index would point at chunks a deploy removed.
  app.use(
    "/static",
    express.static(path.join(CLIENT_BUILD_DIR, "static"), {
      immutable: true,
      maxAge: ONE_YEAR_S * 1000,
      fallthrough: false,
    }),
  );
  app.use(
    express.static(CLIENT_BUILD_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  // Every path is a client-side pushState route: "/" is the bare site, anything else an in-map address or the 404.
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" || req.path.includes(".")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(CLIENT_BUILD_DIR, "index.html"));
  });

  return app;
};

/**
 * Owns the sockets and nothing about the game: validates frame shapes, forwards to the
 * World, implements its Outbox. HEARTBEAT is not optional: a vanished peer (lid closed,
 * wifi dropped) often never fires `close`; a socket that hasn't ponged by the next sweep
 * is terminated, which DOES fire `close` and removes the ghost.
 */

interface Conn {
  ws: WebSocket;
  /** null until `hello` is accepted. */
  sessionId: string | null;
  isAlive: boolean;
}

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
    case "tunnel:toggle":
      world.toggleTunnel(sessionId, msg.id);
      return;
    case "player:click":
      world.clickPlayer(sessionId, msg.id);
      return;
    case "host":
      world.host(sessionId, msg.id, msg.step);
      return;
    case "shoot":
      world.shoot(sessionId, msg);
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
