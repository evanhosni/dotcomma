import http from "node:http";
import { closeDb, getDb, resolveDatabasePath } from "./data/db.js";
import { TICK_MS } from "./game/tick.js";
import { PhysicsWorld } from "./game/physics/physicsWorld.js";
import { SAVE_INTERVAL_MS } from "./game/persistence.js";
import { createApp } from "./http.js";
import { attachWebSocketTransport } from "./transport/ws.js";

/**
 * Boot. One HTTP server does both jobs: Express serves the built client, and
 * the WebSocket game transport attaches to this same server so the client
 * connects back to its own origin — no CORS, one port, one Railway service.
 */
const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";

// Open (and schema-check) the database BEFORE listening: a stale schema must
// fail the boot loudly, not the first player's connect.
getDb();
console.log(`[db] ${resolveDatabasePath()}`);

// The server physics world (headless Rapier + the glitch-city height
// function): every synced NPC's body lives here. WASM init is async, so it is
// ready BEFORE the transport accepts a single registration.
const physics = await PhysicsWorld.create();
console.log("[physics] rapier ready");

const server = http.createServer(createApp());
const { wss, world } = attachWebSocketTransport(server, physics);

// Periodic save sweep: a coarse timer, deliberately NOT a game tick. Each
// player is written at most once per SAVE_INTERVAL_MS and only if dirty.
const saveSweep = setInterval(() => world.flushDirty(), SAVE_INTERVAL_MS / 3);
saveSweep.unref();

// The world tick: every synced actor's state machine runs HERE, at TICK_HZ.
const worldTick = setInterval(() => world.tick(), TICK_MS);
worldTick.unref();


server.listen(PORT, HOST, () => {
  console.log(`[dotcomma] listening on http://${HOST}:${PORT}`);
});

const shutdown = (signal: string) => {
  console.log(`[dotcomma] ${signal} — shutting down`);
  clearInterval(saveSweep);
  clearInterval(worldTick);
  for (const ws of wss.clients) ws.close(1001, "server shutting down");
  const saved = world.saveAll();
  if (saved) console.log(`[db] saved ${saved} dirty player(s)`);
  wss.close();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Don't hang a deploy if a keep-alive connection lingers.
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
