# Terrain

## How it works

The terrain is an infinite grid of square chunks around the camera, each one a mesh (plus an
optional water mesh and physics collider). This folder only *renders* the terrain. Every height and
every shader attribute comes from the height pipeline in
[`utils/workers/`](../../utils/workers/README.md), which runs in the terrain worker.

**Files**
- [`TerrainRenderer.tsx`](TerrainRenderer.tsx): the chunk lifecycle. `<Domain>` mounts it unless
  `terrain={false}` is passed (the home domain passes it). It renders `null` and does everything
  imperatively in `useFrame`.
- [`lodConfig.ts`](lodConfig.ts): the five LOD levels (chunk size, segments, ring distance, collider,
  skirt depth, rivers on or off, blend-field clamping).
- [`lodQuadtree.ts`](lodQuadtree.ts): `computeDesiredChunks`, the quadtree's leaves around the player.
- [`lodSwaps.ts`](lodSwaps.ts): `LodSwapper`, the chunk-set bookkeeping between "desired" and "drawn":
  stale chunks, pruning, and the LOD cross-fades. Pure (no Three), so
  [`lodSwaps.test.ts`](lodSwaps.test.ts) simulates walks through it and checks coverage every frame.
- [`material.ts`](material.ts): builds the ONE terrain `ShaderMaterial` from every region's base shader
  and every biome's shader, and its fade twin (`createLodFadeMaterial`). See [Shaders](../shaders/README.md).
- [`vertexData.ts`](vertexData.ts): runs the same height pipeline on the main thread (`getVertexData`,
  `getVertexDataRaw`, `ensureVertexCompute`). The player backstop, respawn and the address resolver
  use it.
- [`chunkGeometry.ts`](chunkGeometry.ts): a chunk's mesh buffers — the grid + skirt layout, the
  geometry pool (`acquireGeometry` / `releaseGeometry`, per LOD) and how a worker result fills them
  (`writeTerrainBuffers`, `writeWaterBuffers`).
- [`terrainWorker.ts`](terrainWorker.ts): the terrain worker client (`requestChunkBuild`) and its
  result type `ChunkBuildResult`.
- [`chunkIndex.ts`](chunkIndex.ts): `ChunkIndex`, the coarse overlap grid `LodSwapper` queries.
- [`types.ts`](types.ts): `Chunk` (key, center, mesh, water mesh, collider body, LOD).

**The LOD quadtree** (`computeDesiredChunks`, [`lodQuadtree.ts`](lodQuadtree.ts)). The world is tiled by LOD5 roots (3360u). A root
closer to the player than the next level's ring splits into four children. Splitting continues
down to 420u chunks, which become LOD1 inside 420u and LOD2 outside it.

| LOD | chunk | segments | spacing | ring | collider | rivers |
|---|---|---|---|---|---|---|
| 1 | 420 | 96 | 4.4u | 420 | yes | yes |
| 2 | 420 | 24 | 17.5u | 1680 | yes | yes |
| 3 | 840 | 4 | 210u | 3360 | no | yes |
| 4 | 1680 | 2 | 840u | 6720 | no | no |
| 5 | 3360 | 1 | 3360u | 8400 | no | no |

**The build loop** (`updateTerrain`, every frame):
1. The desired set is recomputed only after about 8u of camera movement. Once the queues are empty
   and the last built chunk is visible, the whole pass is skipped.
2. Chunks that are new or have changed LOD are queued. The queue is re-sorted nearest-first
   against the current camera.
3. Builds run until the `BUILD_BUDGET_MS` (5ms) deadline, with at least one chunk per frame.
   The queue is sorted LOD1 first, then LOD2, each nearest-first, so the collider LODs around the
   player always build before anything far. Once the terrain has loaded, the visual-only far LODs
   (3–5) yield while the machine is struggling (`isMachineStruggling()` from the TaskQueue): at most
   one per `FAR_BUILD_INTERVAL_MS` (250ms). That never opens a hole: an old chunk stays visible until
   its replacements are built. Each chunk's main-thread finishing time is charged to the shared
   TaskQueue frame budget (`chargeFrameWork`), so queued work backs off after a heavy terrain frame.
   `buildChunk` asks the terrain worker (`requestChunkBuild`, message `BUILD_CHUNK`) for heights, normals, collider heights, the
   blend fields, road/river distances and water heights, then writes them into a pooled geometry
   (`acquireGeometry` / `releaseGeometry`, pooled per LOD).
4. `processSwaps` starts the LOD swaps that are ready (next section). An old chunk stays drawn until
   every new chunk covering its area is built and has faded in, so the ground never has holes. The
   overlap tests go through `ChunkIndex`, a coarse grid, so they don't have to scan every chunk.

**LOD swaps cross-fade** ([`lodSwaps.ts`](lodSwaps.ts)). A swap is one connected group of overlapping
chunks: one coarse chunk and the finer ones inside it (refine), the reverse (coarsen), or LOD1 ↔ LOD2 on
one 420u square. It starts once its old chunks are all opaque and its new ones all built. For
`LOD_FADE_SECONDS` (0.35s) both are drawn with a complementary SCREEN-DOOR dither: every drawn chunk has
a range [`fadeLo`, `fadeHi`) and keeps the pixels whose screen-door threshold (`lodFadeDiscards` in
[`lodFade.ts`](../shaders/lodFade.ts): the 4×4 Bayer pattern of the objects' spawn fade) falls in it. The new chunks hold [0, p) and the old ones
[p, 2) of one progress p, so every pixel of that ground is drawn by exactly one of them: no hole, no
z-fighting, nothing shaded twice, and no sorting. When p reaches 1 the old chunks are destroyed.
- **Water** is a child of its chunk and takes the chunk's range (`syncLodFade` writes it before each
  draw), so the old and new water sheets never both draw a pixel.
- **Skirts** are part of the chunk and fade with it. For each hash value the drawn chunks form a
  complete tiling (every swap either all-old or all-new), so the skirts cover a mid-fade LOD boundary
  exactly as they cover a static one.
- **Reversal:** if an old chunk becomes desired again mid-fade, p runs backwards; at 0 the new chunks
  are hidden (not destroyed; they are pruned like any undrawn chunk, or reused if desired again).
- **No chaining:** a chunk mid-fade never starts another swap; it waits until its fade ends. A swap
  whose old and new chunks do not cover the same area (land that was never drawn) is instant, and a
  chunk that replaces nothing is drawn at once.
- **Material:** fading chunks draw the FADE TWIN (`TERRAIN_LOD_FADE` define). Putting `discard` in the
  one opaque program would disable early depth testing for every terrain fragment, so only fading
  chunks pay for it. The twin's program is linked during the load by a zero-area warm mesh.
- **Colliders** are untouched: built with the chunk, removed when it is destroyed. The old ground stays
  solid until its fade ends, and the new ground has been solid since it was built.
- **Steady state:** `swapper.busy` keeps the update pass running while a fade is active or just ended,
  and the early-out returns once nothing is fading.
- `window.__terrainLod` (dev builds) exposes the swapper and the chunk map; `swapper.fadeSeconds = 0`
  swaps in one frame (for A/B measurements).

**Skirts.** Each chunk has a vertical ring hanging below its edge (`skirtDepth` per LOD) that
hides the crack where it meets a coarser neighbor. Skirt vertices copy the edge's attributes and
normals.

**Colliders.** LOD1 and LOD2 chunks get a Rapier heightfield built directly in the physics world
(`generateColliders`) and removed in `destroyChunk`. They are never React `<RigidBody>`s. Far
LODs (`hasCollider: false`) also skip flatten pads in the worker.

**Water.** A chunk with water in reach gets a child mesh on the same pooled grid. Dry vertices
are pushed below the ground. The water program is linked at mount (`warmPrograms`), not when the first water builds. See [Water](../water/README.md).

**Matrices.** The terrain group, every chunk plane and its water compose once (`matrixAutoUpdate = false`; `buildChunk` re-composes after placing): with a composing parent every chunk's matrixWorld was recomputed each frame.

**Loading gate.** The component sets `terrainLoaded` and `progress` in `GameContext`, and the
Player waits for them. A new `playerSpawn` (fast travel) restarts the gate. `resetTerrainSystem()`
clears the module state when the domain switches.

## How to use/add

N/A. There is one terrain system, and the content it draws comes from regions and biomes. Knobs:
- Ring sizes and mesh density: `LOD*_MAX_DISTANCE` and `LOD*_SEGMENTS` in [`lodConfig.ts`](lodConfig.ts).
  `CAMERA_FAR` (`src/player/constants.ts`) must lie between the LOD4 and LOD5 rings; lodConfig.ts
  throws in dev when it doesn't. LOD1 must stay the finest
  level, because the player's slope tuning was measured on it.
- Seams at LOD boundaries: raise that level's `skirtDepth` in `LOD_LEVELS`.
- Build smoothness vs. catch-up speed: `BUILD_BUDGET_MS` at the top of
  [`TerrainRenderer.tsx`](TerrainRenderer.tsx).
