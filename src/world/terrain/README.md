# Terrain

## How it works

An infinite LOD quadtree of chunk meshes around the camera (plus optional water mesh and collider). This folder only renders; every height and attribute comes from the height pipeline in [../../utils/workers/](../../utils/workers/README.md).

- [TerrainRenderer.tsx](TerrainRenderer.tsx): the chunk lifecycle, all imperative in `useFrame` (`updateTerrain`). Mounted by `<Domain>` unless `terrain={false}`.
  1. Recompute the desired set (`computeDesiredChunks`, [lodQuadtree.ts](lodQuadtree.ts)) after camera movement; skip the pass in steady state.
  2. Queue new/changed chunks, sorted collider LODs first then nearest-first (`prepareBuildQueue`).
  3. Build until `BUILD_BUDGET_MS`: `buildChunk` awaits the chunk's worker build and writes it into pooled geometry (`acquireGeometry`, `writeTerrainBuffers`, [chunkGeometry.ts](chunkGeometry.ts)). Far LODs throttle to `FAR_BUILD_INTERVAL_MS` while `isMachineStruggling()`.
  4. `processSwaps` swaps LODs.
  - `useLoadingGate` drives the loading bar and opens the gate (`terrainLoaded`) when the queue first drains.
- [buildRequests.ts](buildRequests.ts): the worker request pipeline. Keeps up to `REQUESTS_IN_FLIGHT` builds requested ahead of their turn (`prefetchQueuedBuilds`, deeper while loading), and requests a destination's chunks before the update pass gets there (`prefetchTerrainAround`, from the load and from FastTravel; a new chunk adopts its early request). [terrainWorker.ts](terrainWorker.ts) is the worker pool (`TERRAIN_WORKER_COUNT`, area affinity).
- [chunkObjects.ts](chunkObjects.ts): what a chunk owns — its plane (`createChunkPlane`), its water child (`ensureWaterMesh` / `releaseWater`, see [../water/README.md](../water/README.md)), its imperative Rapier heightfield on collider LODs (`generateColliders`, removed in `destroyChunk`), and `syncLodFade`, which writes the chunk's dither range before each draw.
- [lodConfig.ts](lodConfig.ts): `LOD_LEVELS` (chunk size, segments, ring distance, `hasCollider`, `skirtDepth`).
- [lodSwaps.ts](lodSwaps.ts): `LodSwapper`. Old chunks stay drawn until their replacements are built, then cross-fade over `LOD_FADE_SECONDS` with complementary screen-door dither (`lodFadeDiscards`) on the fade twin material (`createLodFadeMaterial`, [material.ts](material.ts)); overlap tests use `ChunkIndex` ([chunkIndex.ts](chunkIndex.ts)).
- Far fade ([../shaders/farFade.ts](../shaders/farFade.ts)): the chunks whose farthest corner reaches the last 72% before `camera.far` (`chunkReachesFarFade` in [lodConfig.ts](lodConfig.ts), re-checked with every desired-set recompute) draw with the far-fade twin (`createFarFadeMaterial`), so the horizon dithers into the sky. The swap twin carries the far fade too. `TerrainRenderer` writes the live `camera.far` into the range every frame. Change the render distance through `CAMERA_FAR`, which the sky, the LOD rings and this fade all follow.
- [material.ts](material.ts) (`getMaterial`): the one terrain material — the shared vertex shader, the defines, and the fragment shader generated from every region and biome ([../shaders/README.md](../shaders/README.md)).
- **Skirts** hang below each chunk edge to hide cracks (shaded at the edge they hang from via the static `skirtDrop` attribute, so a seam shows matching ground).
- [vertexData.ts](vertexData.ts): the same pipeline on the main thread (`getVertexData`, `getVertexDataRaw`, `ensureVertexCompute`).
- `resetTerrainSystem()` clears the module state on domain switch. [types.ts](types.ts): `Chunk`, `TerrainState`.

Seam debugging: devmode (F1) "tint skirts" paints every skirt face magenta (`skirtTintUniform`, [../shaders/skirtTint.ts](../shaders/skirtTint.ts)) and "no LOD fade" swaps LODs in one frame (`swapper.fadeSeconds = 0`).

## How to add another

N/A — there is one terrain system; content comes from regions and biomes.

Tune: `LOD*_MAX_DISTANCE`, `LOD*_SEGMENTS`, `skirtDepth` in [lodConfig.ts](lodConfig.ts) (the outermost ring, LOD4, reaches exactly `CAMERA_FAR`), `BUILD_BUDGET_MS` in [TerrainRenderer.tsx](TerrainRenderer.tsx), and `REQUESTS_IN_FLIGHT` / `LOADING_REQUESTS_IN_FLIGHT` in [buildRequests.ts](buildRequests.ts).
