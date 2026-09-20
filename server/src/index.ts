import http from "node:http";
import { closeDb, getDb, resolveDatabasePath } from "./data/db.js";
import { TICK_MS } from "./game/tick.js";
import { PhysicsWorld } from "./game/physics/physicsWorld.js";
import { SAVE_INTERVAL_MS } from "./game/persistence.js";
import { createApp } from "./http.js";
import { attachWebSocketTransport } from "./transport/ws.js";

// One HTTP server for both the static client and the WebSocket transport: the
// client connects back to its own origin — no CORS, one port, one Railway service.
const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";

// A stale schema must fail the boot loudly, not the first player's connect.
getDb();
console.log(`[db] ${resolveDatabasePath()}`);

// Awaited before the transport accepts a single registration (WASM init is async).
const physics = await PhysicsWorld.create();
console.log("[physics] rapier ready");

const server = http.createServer(createApp());
const { wss, world } = attachWebSocketTransport(server, physics);

// Deliberately a coarse timer, NOT the game tick (see world.ts write policy).
const saveSweep = setInterval(() => world.flushDirty(), SAVE_INTERVAL_MS / 3);
saveSweep.unref();

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
  // A lingering keep-alive connection must not hang a deploy.
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
