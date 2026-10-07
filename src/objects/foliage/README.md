# Foliage

## How it works

Vegetation at tens of thousands of billboards per chunk. A plant type is only its art and defaults; the whole pipeline is the base: [Foliage.tsx](Foliage.tsx) (chunk lifecycle, `createFoliage`), [foliageLod.ts](foliageLod.ts) (which blades a chunk holds and draws by distance) and [foliageMaterial.ts](foliageMaterial.ts) (the shader).

- **Chunks**: `FOLIAGE_CHUNK_SIZE` chunks around the camera, requested nearest-first (`MAX_PENDING_CHUNKS` in flight), only out to where the fade reaches zero.
- **Placement** ([../../utils/workers/foliage.worker.ts](../../utils/workers/foliage.worker.ts), client [foliageWorker.ts](foliageWorker.ts)): seeded points at `density`, filtered by `biomeIds`, `heightRange`, `slopeRange`/`slopeBlend`, `roadDistanceRange`, no water (or, with `underwater`, ONLY under water, each plant cut to the depth so no tip breaks the surface), never inside a building's silhouette (`buildingFootprints.ts`: the ground-floor ring of the same seeded plan the building draws, not the proxy hull, which is fattened for the leaning floors above — blades grew up through floors); thinned by the terrain material's biome weight (so fields dither across biome edges) and off the riverbed (`RIVER_BED_PLANT_RAMP`). Streamed as `Float32Array`s straight into instance attributes.
- **Rendering**: one instanced billboard mesh per chunk, one shared shader (billboarding, sway, distance fade, quantization, curvature, night dim), spawn fade per chunk.
- **LOD**: instances arrive sorted by fade distance, so a far chunk draws a shorter prefix (`instanceCount`), plus a density taper (`LOD_TAPER_START`, `LOD_TAPER_END`, `LOD_TAPER_MIN`), and holds only a band of that order, widened on approach (`FOLIAGE_BANDS`) — all in [foliageLod.ts](foliageLod.ts); far chunks draw a 1-segment blade (`wantsLowBladeDetail`).
- `createFoliage(defaults)` returns the plant component. Props resolve mount → `<Foliage>` group → plant defaults; without `biomeIds` a field restricts to its enclosing `<Biome>`. Two plants sharing a `seed` are a content error.

Plants: [grass/GrassField.tsx](grass/GrassField.tsx) and [seaweed/SeaweedField.tsx](seaweed/SeaweedField.tsx) (`underwater`, on the lake bed).

## How to add another

1. Art: a transparent upright PNG in `public/textures/`, or a module-level procedural texture like `getBladeTexture`.
2. `src/objects/foliage/<name>/<Name>Field.tsx`:
   ```tsx
   export const FernField = createFoliage({
     seed: "fern", // unique per plant
     png: "/textures/fern.png",
     density: …, width: …, height: …, sway: …, slopeRange: […], renderDistance: …,
   });
   ```
3. Mount `<FernField />` in a biome's `<Foliage>` group.
4. Edit the base only for behavior every plant should get; a new filter also goes in `FoliageChunkParams` ([foliageWorker.ts](foliageWorker.ts)).
