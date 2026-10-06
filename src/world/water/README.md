# Water

## How it works

Water is a flat surface placed by the CPU; waves and shore fade are shader-only. Physics ignores it.

- **Lakes** ([../../utils/workers/lakes.ts](../../utils/workers/lakes.ts)): a biome with `water: { depth }`. Its level is the region base at the cell site minus `LAKE_SURFACE_BELOW_BASE`, blended across neighboring water cells (`lakeLevelAt`). The bed is built relative to that level (`SHORE_RISE` at the shore); `shoreLift` raises nearby land so it never sits below the water.
- **Rivers** ([../../utils/workers/rivers/riverField.ts](../../utils/workers/rivers/riverField.ts)): the surface follows the terrain along the centerline minus `RIVER_SURFACE_BELOW`; `riverMouthShare` merges a river into lake water at its mouth, and `riverLakeMerge` sinks the land between a river and a lake close beside it under the lake (one water, no levee).
- Both produce `VertexResult.waterHeight` (`NaN` when no water is near).
- **Mesh:** a chunk with water gets a child mesh on the same pooled grid (`ensureWaterMesh` in [../terrain/chunkObjects.ts](../terrain/chunkObjects.ts), filled by `writeWaterBuffers`), sharing the chunk's LOD fades and disposal (`releaseWater`). Dry vertices are pushed below the ground; wet ones carry `waterDepth`.
- **Material** ([waterMaterial.ts](waterMaterial.ts)): one shared `getWaterMaterial()`, clock advanced by `tickWater()`. Vertex swell + curvature; fragment `worldFbm` normals, fresnel, glint, depth color, alpha fade at the shore, night dim and dither.

## How to add another

1. In a biome's `spec.ts`, set `water: { depth }`, `joinable: true`, and usually `prohibitRoads: true` (template: `src/world/domains/overworld/regions/ocean/biomes/lake/`).

Tune: colors and fades in [waterMaterial.ts](waterMaterial.ts) (wavelengths must divide `WORLD_WRAP`); `LAKE_SURFACE_BELOW_BASE`, `SHORE_RISE` in `lakes.ts`; `RIVER_SURFACE_BELOW` in `rivers/riverNetwork.ts`.
