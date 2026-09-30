# Foliage

## How it works

**Foliage** is vegetation at a scale no other class handles: up to ~32k billboards per 64u chunk. A plant type is only its **art and defaults**. The whole pipeline is one base, [Foliage.tsx](Foliage.tsx):

- **Chunks:** 64u chunks around the camera, requested nearest-first (at most 4 in flight) and only out to where the fade reaches zero.
- **Placement** (off-thread, [../../utils/workers/foliage.worker.ts](../../utils/workers/foliage.worker.ts), client [foliageWorker.ts](foliageWorker.ts)):
  - It samples the terrain on a coarse 2u grid and places blades by a seeded PRNG at `density` per 1,000,000 sq units.
  - It filters by `biomeIds`, `heightRange`, `slopeRange` (fading over `slopeBlend` degrees) and `roadDistanceRange`, and it skips water.
  - Blades thin out with the terrain material's biome **weight**, so a field dithers away across a biome edge instead of stopping on a line.
  - Plants stay off the **riverbed**: against the same `riverBedDistance` field and edge the terrain shader paints the bed by (`RIVER_BED_FULL_INSET`, `world/shaders/constants.ts`), density ramps from 0 where the bed fully covers the ground to full over `RIVER_BED_PLANT_RAMP` (8 factor-1 units), so the sand is bare and only a sparse fringe reaches its fade. The per-blade roll is a hash of the chunk seed and draw index, run after every other filter, so it only ever removes blades: a chunk with no ground inside the ramp is bit-identical to before.
  - The worker streams the result as `Float32Array`s straight into GPU instance attributes.
- **Rendering:** one instanced billboard mesh per chunk, with one shader for every plant. The shader does camera-facing billboards, wind sway, per-instance distance fade, quantization, world curvature and night dimming.
- **Spawn fade:** each chunk dithers in when it is added, like every game object ([../../vfx/spawnFade.ts](../../vfx/spawnFade.ts), a `SpawnFadeSet` over the chunk meshes). The per-blade distance shrink stays the fade OUT: the instance-count truncation is built on it.
- **LOD:** the worker sorts instances by their fade distance, so a far chunk just draws a shorter prefix of its instances (`instanceCount`). There is also a mild density taper past 150u.

`createFoliage(defaults)` returns a component. Precedence, as for `<Dressing>`: the mount's own props, then the enclosing `<Foliage>` group's (`renderDistance`), then the plant's defaults. Without an explicit `biomeIds`, a field restricts itself to the `<Biome>` it is mounted in (via `BiomeContext`). In dev, two different plant types mounted on one `seed` log an error.

The only plant today is grass, [grass/GrassField.tsx](grass/GrassField.tsx): a canvas-drawn blade texture plus `createFoliage({ seed: "grass", … })`.

## How to use/add

### Use an existing plant

Mount it in a biome's `<Foliage>` group (`src/world/domains/overworld/regions/<region>/biomes/<biome>/biome.tsx`) and override what you need:

```tsx
<Foliage>
  <GrassField density={8000000} slopeRange={[0, 28]} color="#6fff00" height={1.3} />
</Foliage>
```

### Add a plant type (e.g. a fern) — 1 new file + 1 mount (unchanged; now seed clashes are caught)

1. Put the billboard image in `public/textures/fern.png`: a transparent PNG, upright, base at the bottom, near-white if you want `color` to tint it. Or draw it procedurally like [grass/GrassField.tsx](grass/GrassField.tsx).
2. Create `src/objects/foliage/fern/FernField.tsx`:
   ```tsx
   import { createFoliage } from "../Foliage";

   export const FernField = createFoliage({
     seed: "fern",          // MUST differ from every other plant
     png: "/textures/fern.png",
     color: "#ffffff",      // multiplied over the texture; #fff keeps its colors
     density: 20_000,       // per 1,000,000 sq units
     width: 0.8,
     height: 0.9,
     sway: 0.08,
     swaySpeed: 0.8,
     slopeRange: [0, 30],
     slopeBlend: 8,
     renderDistance: 200,
   });
   ```
   A procedural `texture` must be a module-level function (its identity keys the material). See `getBladeTexture` in the grass file.
3. Mount `<FernField />` in the biome's `<Foliage>` group.

Nothing else is needed: chunking, streaming, the shader, curvature, LOD and disposal come from the base.

Two plants with the **same seed and density** land on identical points and grow through each other, so always give a new plant its own seed (dev logs an error when two plant types share one).

Only edit [Foliage.tsx](Foliage.tsx) for behavior no plant has yet (a new filter, a new shader term). Such a change applies to every plant. A new filter also goes into `FoliageChunkParams` ([foliageWorker.ts](foliageWorker.ts); the worker imports the same type).
