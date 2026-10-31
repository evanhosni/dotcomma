# Foliage

## How it works

Vegetation at tens of thousands of billboards per chunk. A plant type is only its art and defaults; the whole pipeline is the base: [index.tsx](index.tsx) (chunk lifecycle, `createFoliage`), [lod.ts](lod.ts) (which blades a chunk holds and draws by distance) and [material.ts](material.ts) (the shader).

- **Chunks**: `FOLIAGE_CHUNK_SIZE` chunks around the camera, requested nearest-first (`MAX_PENDING_CHUNKS` in flight), only out to where the fade reaches zero.
- **Placement** ([../../utils/workers/foliage.worker.ts](../../utils/workers/foliage.worker.ts), client [foliageWorker.ts](foliageWorker.ts)): seeded points at `density`, filtered by `biomeIds`, `heightRange`, `slopeRange`/`slopeBlend`, `roadDistanceRange`, no water (or, with `underwater`, ONLY under water, each plant cut to the depth so no tip breaks the surface), never inside a building's silhouette (`buildingFootprints.ts`: the ground-floor ring of the same seeded plan the building draws, not the proxy hull, which is fattened for the leaning floors above — blades grew up through floors); thinned by the terrain material's biome weight (so fields dither across biome edges) and off the riverbed (`RIVER_BED_PLANT_RAMP`). Streamed as `Float32Array`s straight into instance attributes.
- **Rendering**: one instanced billboard mesh per chunk, one shared shader (billboarding, sway, distance fade, quantization, curvature, night dim), spawn fade per chunk.
- **Cave mouths**: nothing grows within a cave mouth's keep-off (`insideMouthKeepOff`, utils/workers/underground/mouthBulge.ts: the widest outline + 0.9 radii + 3u around its section), checked after every random draw so it only ever removes blades.
- **LOD**: instances arrive sorted by fade distance, so a far chunk draws a shorter prefix (`instanceCount`), plus a density taper (`LOD_TAPER_START`, `LOD_TAPER_END`, `LOD_TAPER_MIN`), and holds only a band of that order, widened on approach (`FOLIAGE_BANDS`) — all in [lod.ts](lod.ts); far chunks draw a 1-segment blade (`wantsLowBladeDetail`).
- `createFoliage(defaults)` returns the plant component. Props resolve mount → plant defaults; without `biomeIds` a field restricts to the `<Biome>` it is mounted in. Two plants sharing a `seed` are a content error.

Plants: [grass/index.tsx](grass/index.tsx), [seaweed/index.tsx](seaweed/index.tsx) (`underwater`, on the lake bed). Snow is not foliage: it is one continuous sheet per chunk, dressing ([snow-drift](../dressing/snow-drift/README.md)).

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
3. Mount `<FernField />` in the biome it grows in.
4. Edit the base only for behavior every plant should get; a new filter also goes in `FoliageChunkParams` ([foliageWorker.ts](foliageWorker.ts)).
