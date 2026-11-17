# Utils

## How it works

Shared helpers. The height pipeline lives in [generation/](../generation/README.md); each worker thread lives beside its feature.

- [math/index.ts](math/index.ts): `MASTER_SEED` and `seedRand(seed)`, the one deterministic roll used by every client, worker and the server; plus `smoothstep`, `clamp`, `lerp`, `wrapAngle`, `distanceToSegment`. [math/types.ts](math/types.ts): `PointXZ` and `RectXZ` (the horizontal plane is always x/z). Also `seededStream(seed)`, many deterministic draws from one seed (one seedRand, then integer mulberry32: the same numbers on every thread and the server), with `between`, `signedUnit`, `intBetween` and `shuffled`; the tunnels and the rocks draw from it.
- [utils.ts](utils.ts): `getAllBiomes`, `framePhaseFromCoords` (spreads every-Nth-frame work across instances), `debugGlobal`; `createTravelRefetch` (fetch around the camera again only after it has travelled; one at a time; `reset` drops a fetch in flight) and `selectNearest` (the nearest N into a fixed array, no allocation): the city lights and the far cave mouths; `reportContentError` (throws outside production).
- [task-queue/TaskQueue.ts](task-queue/TaskQueue.ts): `TaskQueue` (`addTask(fn, { at, weight })`, `removeTask`; `new TaskQueue({ weight, bias, concurrency })`). All queues share one per-frame budget; the next task is the lowest rank (distance to camera × queue weight × task weight + bias) in any queue; a queue runs `concurrency` tasks at once (default 1: a task awaiting a worker holds its queue); ranks above `BACKGROUND_RANK` are background. `isMachineStruggling()` / `chargeFrameWork()` let terrain share it.
- [render/](render): the helpers that import three. [render/utils.ts](render/utils.ts): `uploadOnFirstDraw` (forces one draw at mount so uploads happen then), `getDistance2DSq`, `freezeStaticSubtree`, `stopMatrixUpdatesWhenFrozen` (makes `matrixWorldAutoUpdate = false` prune the per-frame matrix update again on three r164+). [render/index.ts](render/index.ts): `warmPrograms`, `meshTemplate`, `instancedTemplate` link shader programs at load (off the main thread through `compileAsync` once `bindProgramCompiler` has bound the renderer, on three r158+); `reportUnwarmedPrograms` is the dev check.
- [spike-trace/index.ts](spike-trace/index.ts): `traceSpan` / `traceEvent`; `__spikeTrace.traceWindow(start, end)` in the console.
- [render/material.ts](render/material.ts): `_material.loadTextures`, `_material.fromShader` (a biome/region material from its shader and texture files) and `textureFileOf`. The terrain shader generator is `world/shaders/biome-materials/index.ts`. [render/geometry.ts](render/geometry.ts): `bakeVertexColor`, `mergeOrThrow` (vertex-colored parts: buildings, doors, tunnels).
- [worker-client/index.ts](worker-client/index.ts): `createWorkerClient`, the one pending map / INIT handshake / terminate every worker client is built on.
- [cursor/index.ts](cursor/index.ts): the crosshair and THE hover arbiter: whatever is under it (an actor, a door, a manhole) `claimHover(target)`s while hovered; the crosshair grows while any claim wants it, and ONE set of window mouse listeners hands each event to the NEAREST claim (`target.distance`). `releaseHover` on leave and unmount.

## How to add another

N/A — these are used, not extended. Common uses:

- Deterministic random: `seedRand(\`myfeature_${x}_${z}\`)`, salted per feature; never `Math.random()` for shared state.
- Heavy main-thread work: a module-level `new TaskQueue()`, `addTask(async () => …, { at: { x, z } })`, split into several tasks.
- Mass off-screen content: `uploadOnFirstDraw(mesh)` (the class bases already do).
