# Actor spawning

## How it works

This is how actors get placed and mounted. It covers actors only: dressing and foliage stream whole chunks instead.

**Registration.** Each entry of a biome spec's `actors` is registered by `<Biome>` as a descriptor (`describeActor(spec)` + the mount's overrides) with the domain store. [collectDescriptors.ts](collectDescriptors.ts) gathers them from the committed regions and **dedupes them by `id`** (the last one wins). That is why a second placement of the same kind with different settings is its own spec with its own id (e.g. `GRASS_BUILDING_SPEC`).

**Placement** ([../../../utils/workers/spawn.worker.ts](../../../utils/workers/spawn.worker.ts), client [spawnWorker.ts](spawnWorker.ts)). The world is split into 250u chunks. For each chunk, each descriptor:
1. Lays a density grid over the chunk and rolls every cell with a seed built from the descriptor `id` and the cell. `density` sets the odds and `clustering` drops cells in clumps. This roll lives in [../../../utils/workers/densityGrid.ts](../../../utils/workers/densityGrid.ts), shared with the flatten pads and dressing.
2. Samples the terrain at the candidate and applies the filters: `biomeIds`, `heightRange`, `slopeRange`, `roadDistanceRange`. Rivers (channel and banks) are always excluded.
3. Rejects the candidate if it falls within `footprint` of an already accepted point of any descriptor (a shared spatial hash). `spacingOverrides` sets the distance to specific other ids. Descriptors are placed in `priority` order: a low number is placed first and wins space.

`flattenGround: true` actors (buildings) take their points from the flatten-pad engine in `vertexCompute.ts` instead, so each one stands exactly on a pad the terrain flattened for it.

Results are cached per chunk in the worker and again on the client, so steady-state batches do not round-trip. Each worker request is time-budgeted (`SPAWN_BUDGET_MS`) and sorted nearest-first. The pool never waits for it: every batch mounts from what is already cached while at most one request fills in the rest. (Awaiting the request held every mount behind up to 100ms of new chunks, and a deference to pending LOD1/LOD2 terrain let a sprinting player's batches run only once per 90 frames: 20 mounts per ~1.5s on a slow machine. Both are gone; the shared TaskQueue's priorities now keep the main thread in order.)

**Mounting** ([ActorPool.tsx](ActorPool.tsx)). Every few frames the pool compares cached points against the camera, per descriptor:
- **spawn radius** = `renderDistance + footprint / 2`. Points inside it mount.
- **despawn radius** = spawn radius × 1.2 (or `despawnDistance`). Mounted actors beyond it unmount.
- **immediate radius** = spawn radius × 0.5 (or `immediateRadius`). An actor that removed itself (walked off, faded out) cannot **re**spawn inside this radius. A first spawn is allowed at any distance.

Ids are position-based (`x_z_descriptorId`), so an actor can never be duplicated. Nothing is permanently despawned. The pool also subscribes the one shared actor frame driver (`driveActorFrames`).

Placement is a pure function of the seed, the descriptor and the terrain, so every client sees the same actors in the same places.

## How to use/add

N/A. You don't add to this system. You set knobs on a descriptor ([../README.md](../README.md)):

| knob | effect |
|---|---|
| `density` | expected instances per 1,000,000 sq units, before filters and spacing |
| `footprint` | spacing radius. Often the real limiter when density is high. |
| `clustering` | 0 = uniform, 1 = heavily clumped |
| `priority` | 0–100, low placed first (default 50) |
| `biomeIds`, `heightRange`, `slopeRange`, `roadDistanceRange` | placement filters. An actor's `biomeIds` are the biomes whose spec lists it (never set by hand); dressing/foliage: unset = every biome. |
| `renderDistance`, `despawnDistance`, `immediateRadius` | the radii above |

Changing an actor's `id`, or any of these knobs, moves every instance of it.

System-wide tuning: `MIN_FRAMES_BETWEEN_BATCHES` and `MAX_MOUNTS_PER_BATCH` in [ActorPool.tsx](ActorPool.tsx), and `SPAWN_BUDGET_MS` in [spawnWorker.ts](spawnWorker.ts).
