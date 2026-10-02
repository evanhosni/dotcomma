# Generation workers and the height pipeline

## How it works

- [vertexCompute.ts](vertexCompute.ts) is the ONLY height implementation. After `initCompute(domainConfig)`, `computeVertexData(x, z)` returns a `VertexResult` ([types.ts](types.ts)): height plus blend fields, road/river distances and water height. The terrain, spawn, foliage and dressing workers, the main thread and the server all run it. It is Three-free and re-exports every module's public API, so outside callers import from it only. Step order is traced in `world/VERTEX_JOURNEY.md`.
- Results share scratch buffers and some steps recurse: copy what you keep. Modules import each other in cycles, so values cross modules only inside functions.

**Modules**
- [voronoi.ts](voronoi.ts): region and biome grids, sites, rolls, walls (`getZoneWalls`, `getBiomeContext`). [zoneBlend.ts](zoneBlend.ts): the wall pass (`accumulateWallFields`, `combineZoneWeights`) and shader slots (`biomeSlotsOf`, `combineSlotWeights`).
- [noise.ts](noise.ts): `terrainNoise`, `biomeNoiseHeight`, road warp `warp`/`unwarp`. [cellCache.ts](cellCache.ts): `CellCache`, `dropOldestHalf`. [places.ts](places.ts): `getPlaceInfo`, `findRegionCell`, `findBiomeCell`.
- [lakes.ts](lakes.ts): `lakeLevelAt`, `shoreLift`, `riverMouthShare` (see [Water](../../world/water/README.md)).
- [rivers/](rivers): rivers are the walls of a third voronoi grid (`RIVER_GRID_SIZE`, `RIVER_GRID_SHIFT`). `getRiverSegments` ([riverNetwork.ts](rivers/riverNetwork.ts)) keeps edges by `riverProbability`, cuts gaps into gorges, ends in ponds or fizzles, and widens toward the ocean; [riverRoadLayer.ts](rivers/riverRoadLayer.ts) (`riverPieceSuppressed`) drops river where roads run along it; `riverFieldAt` ([riverField.ts](rivers/riverField.ts)) gives the per-vertex distance, width factor and surface, and `capRiverBed` limits the bed paint outside cities, blending in at the city wall beside a quay.
- [roads/](roads): `getNetwork` ([freewayNetwork.ts](roads/freewayNetwork.ts)) links cities within `FREEWAY_LINK_CELLS` by shortest wall paths into `FreewayRun`s, graded by [freewayGrade.ts](roads/freewayGrade.ts); `getCityTerrain` ([cityTerrain.ts](roads/cityTerrain.ts)) builds districts, blocks, arterials, the belt and quays into one road-distance field and plateau height; [cityFeatures.ts](roads/cityFeatures.ts) and [runLamps.ts](roads/runLamps.ts) enumerate dressing points; [roadFragments.ts](roads/roadFragments.ts) turns river-severed road scraps into bank removes city block islands too small to build on (to road or to bank), and removes bare road specks away from deck ends.
- [bridges/](bridges): `getFreewayBridges` ([freewayBridges.ts](bridges/freewayBridges.ts)); see [Bridges](../../objects/dressing/bridges/README.md).
- [flattenPads.ts](flattenPads.ts): `flattenGround` actors get a deterministic pad under each instance; `getFlattenPoints` feeds both the spawn worker and `applyFlattenPads`. `computeVertexDataRaw` is the pad-free height.
- [densityGrid.ts](densityGrid.ts): the one density roll and placement filters (incl. `riverKeepOff`). [densityPoints.ts](densityPoints.ts): `generateDensityPoints`.
- [workerClient.ts](workerClient.ts): `createWorkerClient` (lazy boot, INIT, id-matched requests, `reset()`). `*.worker.ts`: terrain, spawn, foliage, dressing.

## How to add another

- **Noise-height biome:** nothing here; set `noise` in its `spec.ts`.
- **Bespoke-height biome:**
  1. Add its id to `src/world/constants.ts` and leave `noise` out of its spec.
  2. Write a pure height module here (like [roads/cityTerrain.ts](roads/cityTerrain.ts)); clear its caches in `initCompute`.
  3. Branch on the id in `zoneBiomeHeight` ([vertexCompute.ts](vertexCompute.ts)), scaled by presence.
  4. Add a case to [blend.test.ts](blend.test.ts).
- **Flatten-pad actor:** set `flattenGround: true` on its placement in a biome spec's `actors`.
- **Dressing enumerator:**
  1. Write `getMyPoints(minX, minZ, maxX, maxZ, …)` here, owning each point by its chunk and validating via `computeVertexData`; re-export it from [vertexCompute.ts](vertexCompute.ts).
  2. Add one entry to `DRESSING_ENUMERATORS` in `src/objects/dressing/enumerators.ts`.
  3. Add determinism and chunk-split cases to [roads/cityFeatures.test.ts](roads/cityFeatures.test.ts).
