# Server

## How it works

- One Node process (Express + `ws`) serves the built client from `build/`, runs the game over WebSockets on the same port, stores player data in SQLite (`node:sqlite`), and simulates every synced NPC on a headless Rapier world.
- It is bundled with esbuild and imports the client's Three-free modules from `src/` (protocol, actor specs and state machines, height pipeline, domain configs, movement resolver), so behavior is written once. The client never imports `server/`.
- [src/index.ts](src/index.ts): boot order — database check, physics world (with its generation worker), HTTP, WebSocket transport, the world tick (`TICK_HZ`/`TICK_MS`/`TICK_SECONDS` in [game/tick.ts](src/game/tick.ts)) and the save sweep, flush on shutdown.
- [src/http.ts](src/http.ts): static client plus a catch-all for the fake URL paths.
- [src/transport/ws.ts](src/transport/ws.ts): sockets, frame validation (`parseClientMessage`), ping/pong reaper, `routeToWorld` (every validated message becomes one `World` call); implements `Outbox`, permessage-deflate on every frame (`PER_MESSAGE_DEFLATE`, context kept across frames; `WS_DEFLATE=off` disables it), and with it off, corking each socket so a tick's frames leave as one write.
- [src/game/world.ts](src/game/world.ts): `World` — sessions, one room per domain, presence, player data, and the entity calls it forwards to the `EntityManager`; talks only through `Outbox`.
- [src/game/persistence.ts](src/game/persistence.ts): `PlayerPersistence` — one record per identity, `validatePatch`, saves on last disconnect or every `SAVE_INTERVAL_MS` if dirty, `saveAll` on shutdown.
- [src/data/](src/data/): all SQL — `db.ts`, append-only `migrations.ts`, `players.ts`.
- [src/game/entities/manager.ts](src/game/entities/manager.ts): the NPC authority. Clients register what they render; kinds from `ACTOR_CATALOG` run their own client state machine here with the nearest player as "the player". [publish.ts](src/game/entities/publish.ts) (`publishTick`) sends changed fields as server-time-stamped snapshots (positions as the shortest decimal of their float32, `ry` to 1e-4).
- [src/game/physics/](src/game/physics/): [physicsWorld.ts](src/game/physics/physicsWorld.ts) (the Rapier world for `PHYSICS_DOMAIN`, one refcounted `ChunkStore` per chunk layer — terrain, dressing — on a budgeted `JobQueue` from [chunks.ts](src/game/physics/chunks.ts)), [chunkGenerator.ts](src/game/physics/chunkGenerator.ts) + [chunkGenerator.worker.ts](src/game/physics/chunkGenerator.worker.ts) (`ChunkGenerator`: the server boot samples each layer's Rapier-free data on a worker thread and the queue only makes the bodies; a dead worker, a failed job, tests, tools and `CHUNK_GENERATOR=inline` build in place; it also answers the bodies' analytic height queries, `PhysicsWorld.heightAt`, so a cold area never blocks a tick), [terrain.ts](src/game/physics/terrain.ts) (heightfield samples identical to the client's), [obstaclePoints.ts](src/game/physics/obstaclePoints.ts) + [obstacles.ts](src/game/physics/obstacles.ts) (dressing colliders from `DRESSING_COLLIDER_SPECS`: Rapier-free points, then bodies), [buildings.ts](src/game/physics/buildings.ts) (sealed building hulls and door positions), [walker.ts](src/game/physics/walker.ts) (a capsule on the shared movement resolver), [npcBody.ts](src/game/physics/npcBody.ts) (`createNpcBody` picks [groundBody.ts](src/game/physics/groundBody.ts) or [freeBody.ts](src/game/physics/freeBody.ts) by the spec's `movement`), [playerBodies.ts](src/game/physics/playerBodies.ts) (a capsule per player).
- [src/cli/](src/cli/): `db:migrate`, `db:inspect`, and `physics:demo` (with [terrainScan.ts](src/cli/terrainScan.ts), which the physics tests share).
- Ops runbook: root [README.md](../README.md#server-database-deploy). NPC sync: [NPC_TRACKING.md](../NPC_TRACKING.md).

## How to add another

- **Synced NPC**: nothing in `server/` — follow "Wiring a NEW NPC" in [NPC_TRACKING.md](../NPC_TRACKING.md); test it headlessly by copying a case in `test/entities.test.ts`.
- **Message type**: see [src/net/README.md](../src/net/README.md). On the server: a case in `parseClientMessage` and one in `routeToWorld` ([ws.ts](src/transport/ws.ts)), and the `World` method it calls.
- **NPC movement kind** (beside `ground`/`free`): a class implementing `NpcBody` (resolve its pose with `writeResolvedPose`) and a branch in `createNpcBody` ([npcBody.ts](src/game/physics/npcBody.ts)), plus the client's branch in `kinematicMover.tsx`.
- **Chunk layer** (another kind of world collider built per chunk): its Rapier-free sampler, an entry in `ChunkLayerData` ([chunkGenerator.ts](src/game/physics/chunkGenerator.ts)) and in the worker's `SAMPLERS`, a `ChunkStore` in `PhysicsWorld`, and a hold in `GroundBody` if walkers need it under them.
- **Database change**:
  1. Append a migration to [src/data/migrations.ts](src/data/migrations.ts) and put its queries in `src/data/`.
  2. Run `npm run db:migrate` on the live database before deploying.
- **Dressing collider**: nothing in `server/` — give the feature a Three-free spec exporting a `DressingColliderSpec` and add it to `DRESSING_COLLIDER_SPECS` in `src/objects/dressing/catalog.ts`.
- **Building variant**: nothing in `server/` — add its spec to `src/objects/actors/building/spec.ts`; the hull follows.
