# Declarative world components

## How it works

- World content is JSX, but these components render nothing. Each **registers** data into the `DomainStore` ([context.ts](context.ts)) of the nearest `<Domain>` in a layout effect, removes it on unmount, and calls `store.invalidate()`.
- `<Domain>` ([Domain.tsx](Domain.tsx)) then **commits** (`commitDomain`): merges the records into `Region[]` → `Biome[]` (biomes merged by `id`), serializes a `DomainConfig` (`../domains/buildDomainConfig.ts` → `../domains/domainConfig.ts`), publishes it with `setActiveDomain` ([../domains/utils.ts](../domains/utils.ts)), and only then mounts `TerrainRenderer` (unless `terrain={false}`), `ActorPool` and `SkyboxSystem`. In dev the result is compared with the server's copy in [../domains/configs.ts](../domains/configs.ts).
- **Specs are the data.** A region/biome `spec.ts` (Three-free) holds id, name, noise, flags, blend widths, biome order and the biome's `actors`. JSX adds only client-only parts (materials, sky, dressing, foliage).
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
