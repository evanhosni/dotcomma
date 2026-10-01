# Actor spawning

## How it works

Places and mounts actors (dressing and foliage stream whole chunks instead).

- **Registration**: `<Biome>` registers each `actors` entry as a descriptor; [collectDescriptors.ts](collectDescriptors.ts) gathers them and dedupes by `id`.
- **Placement** ([../../../utils/workers/spawn.worker.ts](../../../utils/workers/spawn.worker.ts), client [spawnWorker.ts](spawnWorker.ts)): per `SPAWN_CHUNK_SIZE` chunk and descriptor, a seeded density grid roll (`rollDensityCell`, [../../../utils/workers/densityGrid.ts](../../../utils/workers/densityGrid.ts), shared with flatten pads and dressing), then the filters (`biomeIds`, `heightRange`, `slopeRange`, `roadDistanceRange`, never in a river), then `footprint` spacing against every accepted point in `priority` order (`spacingOverrides` per id). `flattenGround` actors take their points from the flatten-pad engine so each stands on its pad.
- Results are cached in the worker and on the client; requests are time-budgeted (`SPAWN_BUDGET_MS`) and nearest-first, and the pool never waits on them.
- **Mounting** ([ActorPool.tsx](ActorPool.tsx)): per descriptor, points inside the spawn radius (`renderDistance` + half `footprint`) mount, actors past the despawn radius (or `despawnDistance`) unmount, and a self-destroyed actor cannot respawn inside the immediate radius (or `immediateRadius`). Ids are position-based, so nothing duplicates. The pool also drives `driveActorFrames`.

## How to add another

N/A — nothing to add; set the knobs above on an actor's spec ([../README.md](../README.md)). Changing an `id` or a placement knob moves every instance.

System tuning: `MIN_FRAMES_BETWEEN_BATCHES`, `MAX_MOUNTS_PER_BATCH` ([ActorPool.tsx](ActorPool.tsx)), `SPAWN_BUDGET_MS`.
