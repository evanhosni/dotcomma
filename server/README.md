# Server

## How it works

- One Node process (Express + `ws`) serves the built client from `build/`, runs the game over WebSockets on the same port, stores player data in SQLite (`node:sqlite`), and simulates every synced NPC on a headless Rapier world.
- It is bundled with esbuild and imports the client's Three-free modules from `src/` (protocol, actor specs and state machines, height pipeline, domain configs, movement resolver), so behavior is written once. The client never imports `server/`.
- [src/index.ts](src/index.ts): boot order — database check, physics world, HTTP, WebSocket transport, the world tick (`TICK_HZ` in [game/tick.ts](src/game/tick.ts)) and the save sweep, flush on shutdown.
- [src/http.ts](src/http.ts): static client plus a catch-all for the fake URL paths.
- [src/transport/ws.ts](src/transport/ws.ts): sockets, frame validation, ping/pong reaper; implements `Outbox`.
- [src/game/world.ts](src/game/world.ts): `World` — sessions, one room per domain, presence, player data; talks only through `Outbox`.
- [src/game/persistence.ts](src/game/persistence.ts): `PlayerPersistence` — one record per identity, `validatePatch`, saves on last disconnect or every `SAVE_INTERVAL_MS` if dirty, `saveAll` on shutdown.
- [src/data/](src/data/): all SQL — `db.ts`, append-only `migrations.ts`, `players.ts`.
- [src/game/entities/manager.ts](src/game/entities/manager.ts): the NPC authority. Clients register what they render; kinds from `ACTOR_CATALOG` run their own client state machine here with the nearest player as "the player". [publish.ts](src/game/entities/publish.ts) (`publishTick`) sends changed fields as server-time-stamped snapshots.
- [src/game/physics/](src/game/physics/): [physicsWorld.ts](src/game/physics/physicsWorld.ts) (the Rapier world for `PHYSICS_DOMAIN`, refcounted `ChunkStore`s on a budgeted `JobQueue` from [chunks.ts](src/game/physics/chunks.ts)), [terrain.ts](src/game/physics/terrain.ts) (heightfields identical to the client's), [obstacles.ts](src/game/physics/obstacles.ts) (dressing colliders from `DRESSING_COLLIDER_SPECS`), [buildings.ts](src/game/physics/buildings.ts) (sealed building hulls), [npcBody.ts](src/game/physics/npcBody.ts) (`createNpcBody` picks [groundBody.ts](src/game/physics/groundBody.ts) or [freeBody.ts](src/game/physics/freeBody.ts) by the spec's `movement`), [playerBodies.ts](src/game/physics/playerBodies.ts) (a capsule per player).
- Ops runbook: root [README.md](../README.md#server-database-deploy). NPC sync: [NPC_TRACKING.md](../NPC_TRACKING.md).

## How to add another

- **Synced NPC**: nothing in `server/` — follow "Wiring a NEW NPC" in [NPC_TRACKING.md](../NPC_TRACKING.md); test it headlessly by copying a case in `test/entities.test.ts`.
- **Message type**: see [src/net/README.md](../src/net/README.md).
- **Database change**:
  1. Append a migration to [src/data/migrations.ts](src/data/migrations.ts) and put its queries in `src/data/`.
  2. Run `npm run db:migrate` on the live database before deploying.
- **Dressing collider**: nothing in `server/` — give the feature a Three-free spec exporting a `DressingColliderSpec` and add it to `DRESSING_COLLIDER_SPECS` in `src/objects/dressing/catalog.ts`.
- **Building variant**: nothing in `server/` — add its spec to `src/objects/actors/building/spec.ts`; the hull follows.
