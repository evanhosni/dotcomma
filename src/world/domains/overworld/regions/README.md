# Regions and biomes

## How it works

- Two nested voronoi grids split the overworld: each **region** cell (`regionGridSize`) rolls a region from `OVERWORLD_REGIONS` ([index.ts](index.ts)), and each **biome** cell (`gridSize`) rolls one of that region's `biomes`. Rolls are `floor(u × count)` over the list **in order**, so list order decides the map and every address.
- A **region** owns a `baseNoise` (relief under all its biomes), a BASE material (`shaders/base.glsl`) and a `<Skybox>`. A **biome** owns its `noise` (or `water` for a lake), a fragment shader (`shaders/fragment.glsl`), its `actors`, and optional `<Dressing>`, `<Foliage>`, `<Skybox>`.
- **No hard edges:** height, material and sky cross-fade at every wall (`accumulateWallFields` in `utils/workers/zoneBlend.ts`). Near its edge a biome fades into its region's base by its "presence". Widths (`blendWidth` / `heightBlendWidth`) resolve biome → region → `defaultBlendWidth`.
- **Data vs JSX:** everything the server needs is in Three-free `spec.ts` files; [../config.ts](../config.ts) builds the server's config from `OVERWORLD_REGIONS`. `region.tsx` is `<Region spec biomes={{ name: Component }}>`; `biome.tsx` is `<Biome spec>` plus client-only children. Ids/names are checked in `../../domainConfig.ts` (unique; name = lowercase letters, used as the address word and `<name>_frag`).
- **Materials:** every region/biome shader is merged into ONE terrain shader (`combineBiomeMaterials`, `world/shaders/combineBiomeMaterials.ts`). Uniform and helper names are global across shaders; at most `MAX_BIOME_SLOTS` biomes per domain. See [../../../shaders/README.md](../../../shaders/README.md).
- City heights are bespoke code (`utils/workers/roads/cityTerrain.ts`); the snow region shares [snow/riverbed.ts](snow/riverbed.ts).

## How to add another

Adding a biome re-rolls its region's cells; adding a region re-rolls every region cell. Existing addresses move.

**Biome**
1. Create `<region>/biomes/<name>/spec.ts` exporting a `BiomeSpec` (`id`, `name`, `joinable`, `noise` or `water`, optional `blendWidth`, `prohibitRoads`, `actors`).
2. Create `shaders/fragment.glsl` (copy [desert/biomes/dust/shaders/fragment.glsl](desert/biomes/dust/shaders/fragment.glsl)).
3. Create `biome.tsx` (copy [desert/biomes/dust/biome.tsx](desert/biomes/dust/biome.tsx)): `<Biome spec>` + `<Material shader textures>`.
4. Append the spec to the region's `spec.ts` `biomes`, and add `<name>: Component` to the `biomes` map in its `region.tsx`.

**Region**
1. Create `<name>/spec.ts` exporting a `RegionSpec` (`id`, `name`, `biomes`, `baseNoise`, `riverProbability`).
2. Create `shaders/base.glsl` (copy [desert/shaders/base.glsl](desert/shaders/base.glsl)) and `region.tsx` (copy [ocean/region.tsx](ocean/region.tsx)): `<Region spec biomes>` + `<Material>` + `<Skybox>`.
3. Add its biomes (above).
4. Append the spec to `OVERWORLD_REGIONS` in [index.ts](index.ts) and add `<name>: Component` to the `<Regions components>` map in [../domain.tsx](../domain.tsx).
5. Optional: themed nouns ([../README.md](../README.md)). The CRT page, sky mix, rivers and server config follow automatically.
