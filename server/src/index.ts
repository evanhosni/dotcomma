import http from "node:http";
import { availableParallelism } from "node:os";
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
// The worker sits beside this entry: src/game/physics/*.ts under tsx, dist/game/physics/*.js in the bundle (--outbase=src).
// CHUNK_GENERATOR=inline builds on the tick's thread instead. The worker stays the default on ONE vCPU too:
// MEASURED pinned to one core (10 fresh areas × 8 NPCs), ticks over 100ms 0–5 with the worker vs 9–30 inline,
// worst tick 90–178 vs 1121–1162ms, NPCs ready after a median 0.5 vs 2.2s — the OS time-slicing the two threads
// beats the tick doing every cold sample itself.
const chunkGeneratorWorker =
  process.env.CHUNK_GENERATOR === "inline"
    ? undefined
    : new URL(`./game/physics/chunkGenerator.worker${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url);
const physics = await PhysicsWorld.create(undefined, { chunkGeneratorWorker });
console.log(`[physics] rapier ready — chunk generation ${chunkGeneratorWorker ? "on a worker" : "inline"}, ${availableParallelism()} CPU(s)`);

const server = http.createServer(createApp());
const { wss, world } = attachWebSocketTransport(server, physics);

// Deliberately a coarse timer, NOT the game tick (see the write policy in game/persistence.ts).
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
