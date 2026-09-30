# Water

## How it works

Water is a flat surface that the CPU places at a known height. Waves, glints and the shoreline
fade are all done in the shader. There is no simulation, and physics does not know water exists:
the player walks on the river or lake bed.

**Where the water height comes from** (the height pipeline, `utils/workers/`):
- **Lakes** ([`utils/workers/lakes.ts`](../../utils/workers/lakes.ts)): a biome whose spec has
  `water: { depth }` is a lake. The ocean region's `lake` biome is the only one today. Its water
  LEVEL is the region base at the cell's site minus 1.5, blended across neighboring water cells by
  `lakeLevelAt` so that two lake cells of one body share one level with no step between them. The
  lake bed is built relative to that level: `SHORE_RISE` above it at the shore, descending to
  `depth` below it inside. Land near a lake is raised to the shore height by `shoreLift`, so dry
  ground never sits below the water beside it.
- **Rivers** ([`utils/workers/rivers/riverField.ts`](../../utils/workers/rivers/riverField.ts)): the surface follows
  the terrain along the river's centerline, minus `RIVER_SURFACE_BELOW`, and eases onto the lake
  level near a mouth. See the Rivers section of the
  [workers README](../../utils/workers/README.md).
- Both end up in `VertexResult.waterHeight`, which is `NaN` where no water is in reach.

**The mesh** ([`world/terrain/TerrainRenderer.tsx`](../terrain/TerrainRenderer.tsx), in `buildChunk`):
a terrain chunk whose worker result has `waterHeights` gets a second mesh on the same pooled grid.
That mesh is a CHILD of the chunk plane (`Chunk.water`), so it shares the chunk's LOD swaps,
visibility and disposal (`releaseWater`). Wet vertices sit at the water height and carry a
`waterDepth` attribute (water minus ground). Dry vertices are pushed below the ground by at least
one vertex spacing, so the surface disappears there.

**The material** ([`waterMaterial.ts`](waterMaterial.ts)): one shared `ShaderMaterial`
(`getWaterMaterial()`), with its clock advanced once per frame by `tickWater()` from
TerrainRenderer.
- Vertex: a small two-wave swell scaled by depth, plus the terrain's precision-safe wrapped
  position and world curvature. Wave lengths (70u, 50u) divide `WORLD_WRAP`.
- Fragment: two scrolling `worldFbm` normal octaves, fresnel, sun glint, a shallow-to-deep color
  ramp over 14u, and an alpha fade over the last 2.5u of depth (a hard cut outlines the LOD
  triangles along every shore). It also applies the night dim and dither. Pixels with depth ≤ 0.02
  are discarded.

## How to use/add

**Add a new lake-type biome** (a pond, a marsh):
1. In the biome's `spec.ts`, set `water: { depth: <units below the level> }` and
   `joinable: true` (so adjacent cells form one body). Usually also set `prohibitRoads: true`
   (keeps inter-city freeways off it) and a `blendWidth` under 250.
2. Nothing else. The level, bed, shore lift, river mouths and water mesh all follow from `water`.
   See `src/world/domains/overworld/regions/ocean/biomes/lake/` for the template.

**Tune the look:** the color constants, `0.18 * swell`, and the alpha fade `smoothstep(0.02, 2.5, …)`
in [`waterMaterial.ts`](waterMaterial.ts). A new world-space wavelength must divide
`WORLD_WRAP` (4200), or the surface will show a seam every 4200 units.

**Tune the levels:** `LAKE_SURFACE_BELOW_BASE` and `SHORE_RISE` in
[`lakes.ts`](../../utils/workers/lakes.ts), and `RIVER_SURFACE_BELOW` in
[`rivers/riverNetwork.ts`](../../utils/workers/rivers/riverNetwork.ts). These change the terrain everywhere.
