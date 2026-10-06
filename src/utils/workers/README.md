# Generation workers and the height pipeline

## How it works

- [vertexCompute.ts](vertexCompute.ts) is the ONLY height implementation. After `initCompute(domainConfig)`, `computeVertexData(x, z)` returns a `VertexResult` ([types.ts](types.ts)): height plus blend fields, road/river distances and water height. The terrain, spawn, foliage and dressing workers, the main thread and the server all run it. It is Three-free and re-exports every module's public API, so outside callers import from it only. Step order is traced in `world/VERTEX_JOURNEY.md`.
- Results share scratch buffers and some steps recurse: copy what you keep. Modules import each other in cycles, so values cross modules only inside functions. A folder's `constants.ts` (and `roads/cityRoadField.ts`, `roads/cityDistricts.ts`) is a LEAF: it imports nothing from the pipeline but the live config, so a top-level value may read it.

**Modules**
- [voronoi.ts](voronoi.ts): region and biome grids, sites, rolls, walls (`getZoneWalls`, `getBiomeContext`). [zoneBlend.ts](zoneBlend.ts): the wall pass (`accumulateWallFields`, `combineZoneWeights`) and shader slots (`biomeSlotsOf`, `combineSlotWeights`).
- [noise.ts](noise.ts): `terrainNoise`, `biomeNoiseHeight`, road warp `warp`/`unwarp`/`warpMax`. [cellCache.ts](cellCache.ts): `CellCache`, `PointCache`, `dropOldestHalf`. [places.ts](places.ts): `getPlaceInfo`, `findRegionCell`, `findBiomeCell`.
- [lakes.ts](lakes.ts): `lakeLevelAt`, `shoreLift`, `riverMouthShare`, `riverLakeMerge` (see [Water](../../world/water/README.md)).
- [rivers/](rivers): rivers are the walls of a third voronoi grid. [riverNetwork.ts](rivers/riverNetwork.ts) (`getRiverSegments`, the piece API) rolls edges by `riverProbability`, ends rivers in ponds or fizzles and widens them toward the ocean; [riverPieceRules.ts](rivers/riverPieceRules.ts) (`riverEdgeBlocked`) decides which pieces are built (water, prohibited biomes, high ground, gap fill, blobs, gorges); [riverRoadLayer.ts](rivers/riverRoadLayer.ts) (`riverPieceSuppressed`) drops river where a road no deck may carry runs along it; [riverSurface.ts](rivers/riverSurface.ts) gives each piece end its water surface (road crossing caps, gorges); [riverField.ts](rivers/riverField.ts) (`riverFieldAt`, `riverQuayAt`) the per-vertex distance, width factor and surface; [riverBedLimit.ts](rivers/riverBedLimit.ts) (`capRiverBed`) where the bed paint ends; [riverChannel.ts](rivers/riverChannel.ts) (`carveRiverChannel`) the carved channel. Shared numbers and reaches (`riverKeepOff`, `riverWetReach`) are in [constants.ts](rivers/constants.ts), shapes in [types.ts](rivers/types.ts).
- [roads/](roads): `getNetwork` ([freewayNetwork.ts](roads/freewayNetwork.ts)) links cities within `FREEWAY_LINK_CELLS` by shortest wall paths into `FreewayRun`s, graded by [freewayGrade.ts](roads/freewayGrade.ts) and laid off the city by [offCityFreeway.ts](roads/offCityFreeway.ts) (step 5). The city: `getCityTerrain` ([cityTerrain.ts](roads/cityTerrain.ts)) turns the districts and arterials ([cityDistricts.ts](roads/cityDistricts.ts)), the block cells and remnants ([cityCells.ts](roads/cityCells.ts)), the belt or its waterfront ([cityWaterfront.ts](roads/cityWaterfront.ts)) and the quays into one road field and plateau height; the field's shared formulas (`freewayField`, `cityCurbDip`, `NO_ROAD_DISTANCE`) are in [cityRoadField.ts](roads/cityRoadField.ts). Dressing enumerators, one per file: [roadMarkers.ts](roads/roadMarkers.ts), [trafficLights.ts](roads/trafficLights.ts), [freewaySidePoints.ts](roads/freewaySidePoints.ts), [citySites.ts](roads/citySites.ts) (the city ones walk a chunk through [cityChunks.ts](roads/cityChunks.ts)) and [runLamps.ts](roads/runLamps.ts). [roadFragments.ts](roads/roadFragments.ts) turns river-severed road scraps into bank, removes city block islands too small to build on (to road or to bank), and removes bare road specks away from deck ends.
- [bridges/](bridges): `getFreewayBridges` ([freewayBridges.ts](bridges/freewayBridges.ts)); the ground under decks is [deckGround.ts](bridges/deckGround.ts) over [drawnSlab.ts](bridges/drawnSlab.ts) and [deckMouth.ts](bridges/deckMouth.ts) (a landed end's approach and mouth); see [Bridges](../../objects/dressing/bridges/README.md).
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
  1. Write `getMyPoints(minX, minZ, maxX, maxZ, …)` in its own file (like [roads/trafficLights.ts](roads/trafficLights.ts)), owning each point by its chunk and validating via `computeVertexData`; re-export it from [vertexCompute.ts](vertexCompute.ts).
  2. Add one entry to `DRESSING_ENUMERATORS` in `src/objects/dressing/enumerators.ts`.
  3. Add determinism and chunk-split cases to [roads/cityFeatures.test.ts](roads/cityFeatures.test.ts).
- **River rule** (whether a piece is built): one more verdict in `classifyRiverPieces` or one more pass in `riverEdgeOwnBlocked` ([riverPieceRules.ts](rivers/riverPieceRules.ts)), with a `RIVER_BLOCK_*` code in [rivers/constants.ts](rivers/constants.ts) if it needs its own reason; a rule the roads impose goes in [riverRoadLayer.ts](rivers/riverRoadLayer.ts). Add a case to [rivers/riverBanks.test.ts](rivers/riverBanks.test.ts) or [rivers/riverGorges.test.ts](rivers/riverGorges.test.ts).
