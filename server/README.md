# Server

## How it works

One Node 24 process (Express + `ws`) serves the built client from `build/` and runs the game on the same port over WebSockets. It stores player data in SQLite (`node:sqlite`) and simulates every synced NPC on a headless Rapier world.

It is **bundled with esbuild** and imports the client's Three-free modules straight from `src/`: the wire protocol, actor specs and state machines, the height pipeline, the domain configs and the movement resolver. Behavior is written once and shared. The client never imports `server/`.

Operations (local setup, database, Railway, deploying) are in the root [README.md → Server, database, deploy](../README.md#server-database-deploy). How NPCs are simulated and synced is in [NPC_TRACKING.md](../NPC_TRACKING.md).

### Layout (`src/`)

| path | job |
|---|---|
| [index.ts](src/index.ts) | Boot order: database schema check → physics world → HTTP → WebSocket transport → 10Hz world tick + save sweep → flush on SIGTERM/SIGINT. |
| [http.ts](src/http.ts) | Static client: `/static` is immutable-cached, `index.html` is no-cache, and there is a catch-all for the fake URL paths. |
| [transport/ws.ts](src/transport/ws.ts) | Sockets only: validates every frame's shape and size, and runs a 30s ping/pong reaper that kills ghost sockets. It implements the `Outbox` interface. |
| [game/world.ts](src/game/world.ts) | `World`: sessions, rooms (one per domain), presence broadcasts, player data, and handing entities to the manager. It talks only through `Outbox`. |
| [game/tick.ts](src/game/tick.ts) | `TICK_HZ` (10). |
| [game/persistence.ts](src/game/persistence.ts) | `PlayerPersistence`: one record per connected **identity** (two tabs share one). `validatePatch`, the write policy (save when the last session leaves if dirty, otherwise at most every `SAVE_INTERVAL_MS`, never on the tick), `saveAll` on shutdown. |
| [data/](src/data/) | ALL SQL. `db.ts` (open, pragmas, refuses a stale schema), `migrations.ts` (append-only, `PRAGMA user_version`; read its header rules), `players.ts` (prepared statements). |
| [game/entities/manager.ts](src/game/entities/manager.ts) | The NPC authority. Clients register entities they render. A kind in the actor catalog (`ACTOR_CATALOG` in `src/world/domains/configs.ts`, derived from the biome specs) runs its **own client state machine** here, with the nearest player as "the player". Buildings get a sealed hull. Zero registrants disposes the entity. |
| [game/entities/publish.ts](src/game/entities/publish.ts) | Diffs each tick against what registrants last saw. Positional changes go out as complete server-time-stamped snapshots. |
| [game/physics/](src/game/physics/) | Server physics, below. |
| [cli/](src/cli/) | `migrate.ts`, `inspect.ts`, `physicsDemo.ts` + `terrainScan.ts` (`npm run physics:demo`). |

### Server physics (`src/game/physics/`)

- [physicsWorld.ts](src/game/physics/physicsWorld.ts): the Rapier world for `PHYSICS_DOMAIN` (overworld only). It initializes the shared height pipeline from `src/world/domains/configs.ts` and owns two refcounted `ChunkStore`s on one budgeted `JobQueue` ([chunks.ts](src/game/physics/chunks.ts)). Nothing is built world-wide: a chunk exists while something holds it.
- [terrain.ts](src/game/physics/terrain.ts): LOD1 heightfields sampled exactly like the client's terrain worker, so the ground is bit-identical.
- [obstacles.ts](src/game/physics/obstacles.ts): the colliders for street lamps, signals, poles and bridge decks, placed by the client's enumerators with each feature's spec placement (`DRESSING_COLLIDER_SPECS` in `src/objects/dressing/catalog.ts`).
- [buildings.ts](src/game/physics/buildings.ts): a building's sealed convex hull, from the client's plan generator, cached per seed.
- [npcBody.ts](src/game/physics/npcBody.ts): the `NpcBody` interface. `createNpcBody` picks by the spec's `movement`:
  - [groundBody.ts](src/game/physics/groundBody.ts) (`"ground"`): a [walker.ts](src/game/physics/walker.ts) capsule on the shared `src/physics/characterMovement.ts`, holding the chunks around it;
  - [freeBody.ts](src/game/physics/freeBody.ts) (`"free"`): velocity integrated as-is, for flyers and swimmers.
- [playerBodies.ts](src/game/physics/playerBodies.ts): a capsule per player so NPCs collide with players.

Every 10s the server logs a `[physics] …` stats line. A tick over 50ms warns.

## How to use/add

- **A synced NPC**: nothing in `server/`. Place its spec in a biome (see [NPC_TRACKING.md](../NPC_TRACKING.md) §6); that catalogs it. `test/catalog.test.ts` checks the catalog. Copy a case in `test/entities.test.ts` to test the NPC headlessly.
- **A message type**: see [src/net/README.md](../src/net/README.md#add-a-message-type).
- **A database change**: append a migration to [data/migrations.ts](src/data/migrations.ts) and put its SQL in `data/`. Run `db:migrate` on the live database BEFORE deploying. The root README explains how.
- **A dressing feature with colliders**: nothing in `server/`. Give it a Three-free `*Spec.ts` exporting a `DressingColliderSpec` (enumerator, placement, collider parts) and add ONE line to `DRESSING_COLLIDER_SPECS` in `src/objects/dressing/catalog.ts`; [obstacles.ts](src/game/physics/obstacles.ts) builds every listed spec. The placement lives in the spec only (the component takes no placement props): the server only sees the spec.
- **A new building variant**: nothing in `server/`. Add its spec to `src/objects/actors/building/spec.ts` and place it in a biome spec's `actors`. The hull follows automatically.

Commands (inside `server/`): `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run db:migrate`, `npm run db:inspect`, `npm run physics:demo`. `npm run dev` at the repo root runs the server and client together.
