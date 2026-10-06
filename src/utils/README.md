# Utils

## How it works

Shared helpers. The height pipeline and workers live in [workers/](workers/README.md).

- [math/_math.ts](math/_math.ts): `MASTER_SEED` and `seedRand(seed)`, the one deterministic roll used by every client, worker and the server; plus `smoothstep`, `clamp`, `lerp`, `wrapAngle`, `distanceToSegment`. [math/types.ts](math/types.ts): `PointXZ` (the horizontal plane is always x/z).
- [utils.ts](utils.ts): `getAllBiomes`, `getDistance2DSq`, `framePhaseFromCoords` (spreads every-Nth-frame work across instances), `freezeStaticSubtree`, `stopMatrixUpdatesWhenFrozen` (makes `matrixWorldAutoUpdate = false` prune the per-frame matrix update again on three r164+).
- [task-queue/TaskQueue.ts](task-queue/TaskQueue.ts): `TaskQueue` (`addTask(fn, { at })`, `removeTask`). All queues share one per-frame budget; the next task is the lowest rank (distance to camera × weight + bias) in any queue; ranks above `BACKGROUND_RANK` are background. `isMachineStruggling()` / `chargeFrameWork()` let terrain share it.
- [uploadOnFirstDraw.ts](uploadOnFirstDraw.ts): forces one draw at mount so uploads happen then. [warmPrograms.ts](warmPrograms.ts): `warmPrograms`, `meshTemplate`, `instancedTemplate` link shader programs at load (off the main thread through `compileAsync` once `bindProgramCompiler` has bound the renderer, on three r158+); `reportUnwarmedPrograms` is the dev check.
- [contentError.ts](contentError.ts): `reportContentError` (throws outside production).
- [spikeTrace.ts](spikeTrace.ts): `traceSpan` / `traceEvent`; `__spikeTrace.traceWindow(start, end)` in the console.
- [material/_material.ts](material/_material.ts): `loadTextures`, `fromShader` (a biome/region material from its shader and texture files) and `textureFileOf`. The terrain shader generator is `world/shaders/combineBiomeMaterials.ts`.
- [cursor/cursor.ts](cursor/cursor.ts): the crosshair; `showCursor` / `hideCursor`.

## How to add another

N/A — these are used, not extended. Common uses:

- Deterministic random: `seedRand(\`myfeature_${x}_${z}\`)`, salted per feature; never `Math.random()` for shared state.
- Heavy main-thread work: a module-level `new TaskQueue()`, `addTask(async () => …, { at: { x, z } })`, split into several tasks.
- Mass off-screen content: `uploadOnFirstDraw(mesh)` (the class bases already do).
