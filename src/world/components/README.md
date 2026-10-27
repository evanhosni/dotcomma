# Declarative world components

## How it works

- World content is JSX, but these components render nothing. Each **registers** data into the `DomainStore` ([context.ts](context.ts)) of the nearest `<Domain>` in a layout effect, removes it on unmount, and calls `store.invalidate()`.
- `<Domain>` ([Domain.tsx](Domain.tsx)) then **commits** (`commitDomain`): merges the records into `Region[]` → `Biome[]` (biomes merged by `id`), serializes a `DomainConfig` (`../domains/buildDomainConfig.ts` → `../domains/domainConfig.ts`), publishes it with `setActiveDomain` ([../domains/utils.ts](../domains/utils.ts)), and only then mounts `TerrainRenderer` (unless `terrain={false}`), `ActorPool` and `SkyboxSystem`. In dev the result is compared with the server's copy in [../domains/configs.ts](../domains/configs.ts).
- **Specs are the data.** A region/biome `spec.ts` (Three-free) holds id, name, noise, flags, blend widths, biome order, the biome's `actors` and its `features`. JSX adds only client-only parts (materials, sky, dressing, foliage).
- **Features** ([../features.ts](../features.ts)): a biome spec's `features` is a JSX tree of DECLARATION components (`defineFeature(name, parent)`: they render nothing) — `<Sewers chance><SewerSideRoom><Spawn actor={BEEBLE_SPEC} /></SewerSideRoom></Sewers>`. The spec becomes `spec.tsx`. A feature exists because it is in the tree, a part because it is inside its feature (a part outside it is a content error), a knob because it is a prop: never a flag besides. `featureTreeOf` walks the elements as DATA, so the server and every worker read the same tree; <Biome> draws each top-level feature's view ([Features.tsx](Features.tsx) `FEATURE_VIEWS`) and lists each `<Spawn>` as its own actor kind (`featureSpawnId`: `beeble@sewers.sideRooms`, cataloged for the server), placed by its feature (`FEATURE_PLACEMENTS`, [../../utils/workers/featurePlacement.ts](../../utils/workers/featurePlacement.ts)) instead of the density roll.
- `<Regions specs components>` and `<Region spec biomes>` ([Region.tsx](Region.tsx)) render a component map keyed by spec `name` **in spec order** (`null` = config-only). `<Biome spec>` ([Biome.tsx](Biome.tsx)) registers the spec and its `actors` via `describeActor` ([Actor.tsx](Actor.tsx)). Mismatches throw in dev.
- **Scope-aware:** `Material` and `Skybox` register differently under `<Domain>`, `<Region>` or `<Biome>` (via `RegionContext` / `BiomeContext`):

| component | domain | region | biome |
|---|---|---|---|
| [Terrain.tsx](Terrain.tsx) | global `TerrainParams` | — | — |
| [Material.tsx](Material.tsx) | `riverTexture` | BASE material | fragment shader (+ optional `riverbed`) |
| [Skybox](../sky/Skybox.tsx) | default sky | region sky | biome override |

- `<Material shader textures>` takes the `.glsl` source and `{ uniform: "file" }` (loaded by `_material.fromShader`); `getMaterial` is the escape hatch for non-texture uniforms.
- Inline object props are keyed by `JSON.stringify` so parent re-renders don't re-commit. Always import from [index.ts](index.ts).

## How to add another

These components are the API; content uses them (recipes: [../domains/overworld/regions/README.md](../domains/overworld/regions/README.md)). To add a new scope-aware setting:

1. Add a field to `DomainStore` in [context.ts](context.ts).
2. Register it from the component in a layout effect.
3. Read it in `commitDomain` ([Domain.tsx](Domain.tsx)).
4. If the server needs it, put it in the spec and serialize it in [../domains/domainConfig.ts](../domains/domainConfig.ts).

To add a FEATURE (something a biome HAS that the server or a worker must know — it generates, collides or spawns):

1. Its declarations, Three-free: `export const Thing = defineFeature<ThingProps>("thing")` and each part `defineFeature<PartProps>("part", "thing")`, plus ONE resolver from the tree to its params (`sewerParamsFrom` in objects/dressing/underground/features.ts is the pattern).
2. A field on `SerializedBiome` (utils/workers/types.ts) filled by `serializeBiome` from that resolver; the generators read it from the live config (biomeFlags.ts `…ParamsOf`).
3. Its view in `FEATURE_VIEWS` ([Features.tsx](Features.tsx)), if it draws.
4. If a `<Spawn>` may be mounted in it or a part: a `FEATURE_PLACEMENTS` entry (the floor points of its places in an area).
5. Mount it in a biome's `spec.tsx` `features`.
