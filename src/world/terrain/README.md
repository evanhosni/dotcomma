# Terrain

## How it works

An infinite LOD quadtree of chunk meshes around the camera (plus optional water mesh and collider). This folder only renders; every height and attribute comes from the height pipeline in [../../utils/workers/](../../utils/workers/README.md).

- [TerrainRenderer.tsx](TerrainRenderer.tsx): the chunk lifecycle, all imperative in `useFrame` (`updateTerrain`). Mounted by `<Domain>` unless `terrain={false}`.
  1. Recompute the desired set (`computeDesiredChunks`, [lodQuadtree.ts](lodQuadtree.ts)) after camera movement; skip the pass in steady state.
  2. Queue new/changed chunks, sorted collider LODs first then nearest-first.
  3. Build until `BUILD_BUDGET_MS`: `buildChunk` asks the worker (`requestChunkBuild`, [terrainWorker.ts](terrainWorker.ts)) and writes into pooled geometry (`acquireGeometry`, `writeTerrainBuffers`, [chunkGeometry.ts](chunkGeometry.ts)). Far LODs throttle to `FAR_BUILD_INTERVAL_MS` while `isMachineStruggling()`.
  4. `processSwaps` swaps LODs.
- [lodConfig.ts](lodConfig.ts): `LOD_LEVELS` (chunk size, segments, ring distance, `hasCollider`, `skirtDepth`).
- [lodSwaps.ts](lodSwaps.ts): `LodSwapper`. Old chunks stay drawn until their replacements are built, then cross-fade over `LOD_FADE_SECONDS` with complementary screen-door dither (`lodFadeDiscards`) on the fade twin material (`createLodFadeMaterial`, [material.ts](material.ts)); overlap tests use `ChunkIndex` ([chunkIndex.ts](chunkIndex.ts)).
- **Skirts** hang below each chunk edge to hide cracks (shaded at the edge they hang from via the static `skirtDrop` attribute, so a seam shows matching ground); **colliders** are imperative Rapier heightfields (`generateColliders`, removed in `destroyChunk`) on collider LODs; **water** is a child mesh (`ensureWaterMesh`, see [../water/README.md](../water/README.md)).
- [vertexData.ts](vertexData.ts): the same pipeline on the main thread (`getVertexData`, `getVertexDataRaw`, `ensureVertexCompute`).
- Sets `terrainLoaded`/`progress` for the Player; `resetTerrainSystem()` clears state on domain switch. [types.ts](types.ts): `Chunk`.

Seam debugging: devmode (F1) "tint skirts" paints every skirt face magenta (`skirtTintUniform`, [../shaders/skirtTint.ts](../shaders/skirtTint.ts)) and "no LOD fade" swaps LODs in one frame (`swapper.fadeSeconds = 0`).

## How to add another

N/A — there is one terrain system; content comes from regions and biomes.

Tune: `LOD*_MAX_DISTANCE`, `LOD*_SEGMENTS`, `skirtDepth` in [lodConfig.ts](lodConfig.ts) (`CAMERA_FAR` must sit between the LOD4 and LOD5 rings), and `BUILD_BUDGET_MS` in [TerrainRenderer.tsx](TerrainRenderer.tsx).
