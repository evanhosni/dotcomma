# Declarative world components

## How it works

World content is written as JSX, but these components render nothing visible. Each one **registers** data into a store owned by the nearest `<Domain>`. The `<Domain>` then **commits** everything into plain data that the workers, the terrain material and the Player read.

```
<Domain>                          store + commit + global systems      (Domain.tsx)
  <Terrain/> <Material/> <Skybox/>   domain scope
  <Regions specs components>      renders each region spec's component, in spec order  (Region.tsx)
    <Region spec biomes>          RegionContext; registers the spec (base noise included)
      <Material/> <Skybox/>         region scope
      …each biome component, in spec.biomes order:
      <Biome spec>                BiomeContext; registers the spec (noise included) + its `actors`  (Biome.tsx)
        <Material/> <Skybox/> <Dressing> <Foliage>   biome scope
```

**Specs are the data, components render them.** A region/biome's `spec.ts` (Three-free — the server's config is built from the same objects) holds everything the terrain needs: id, name, `baseNoise` / `noise`, water, flags, blend widths, the biome order and the biome's `actors`. The JSX only adds what is client-only (materials, sky, dressing, foliage), so the two cannot drift:
- `<Regions specs components>` and `<Region biomes>` take a component map keyed by spec `name` and render it **in spec order** — JSX order can no longer disagree with the voronoi order. The map must have exactly one entry per spec (`null` for a config-only biome or region, which renders the bare `<Biome spec>` / `<Region spec>` so its spec still registers); a mismatch throws in dev.
- A `<Region>`/`<Biome>` asserts it is the spec its parent's list put at that position (by id + name), and throws in dev when mounted outside such a list.
- `<Biome>` registers the spec's `actors` (placements of `ActorSpec`s with per-biome overrides) through [Actor.tsx](Actor.tsx): `describeActor(spec)` is the client descriptor (the member component the spec names, default `ModelActor`, plus every spec attribute), the mount's overrides win, and a kind the server has nothing to simulate defaults to `serverSynced: false`.

**Scope-aware components.** `Material` and `Skybox` check which context they sit in (`BiomeContext`, then `RegionContext`, otherwise the domain) and register different data in each. `Terrain` is domain-scope only (throws in dev under a region or biome — relief belongs in the spec):

| component | under `<Domain>` | under `<Region>` | under `<Biome>` |
|---|---|---|---|
| [Terrain.tsx](Terrain.tsx) | global `TerrainParams` (`seed`, `gridSize`, `river`, `cityConfig`…; unset = `world/defaults.ts`) | — (`spec.baseNoise`) | — (`spec.noise`) |
| [Material.tsx](Material.tsx) | `riverTexture`: the default river bed | the region's BASE material, which biomes fade into at their edges | the biome's fragment shader; optional `riverbed`: its own river bed |
| [Skybox](../sky/Skybox.tsx) | the default sky (its `radius` is the only one used) | the region's sky, mixed across region edges by position | an override that wins inside the biome |

`<Material shader textures>` is the usual form: the `.glsl` source plus `{ uniformName: "file.png" }` (files under `public/textures/`, loaded by `_material.fromShader`). `getMaterial` is the escape hatch for non-texture uniforms. `Skybox` lives with the sky system and is re-exported from [index.ts](index.ts). Always import from `world/components`.

**Registration** ([context.ts](context.ts) holds `DomainStore`):
- Every component writes into the store in a `useLayoutEffect`, removes its entry on unmount, and calls `store.invalidate()`.
- Inline object props (textures, riverbeds, descriptors) are keyed by `JSON.stringify`, so a parent re-render doesn't trigger a re-commit.
- The store's `Map`s keep insertion order, which is render order, which is spec order.

**Commit** (`commitDomain` in [Domain.tsx](Domain.tsx)):
- Layout effects fire child-first, so every registration has landed by the time `<Domain>`'s own effect runs.
- It merges the records into `Region[]` → `Biome[]`. Biomes are merged by `id`, so one biome listed under two regions becomes one object; two different names on one id throws in dev.
- It serializes them into a `DomainConfig` ([../domains/buildDomainConfig.ts](../domains/buildDomainConfig.ts) → [../domains/domainConfig.ts](../domains/domainConfig.ts), which also asserts unique ids/names) and publishes the result through `setActiveDomain` ([../domains/utils.ts](../domains/utils.ts)).
- Only then does it mount `TerrainRenderer` (unless `terrain={false}`), `ActorPool` and `SkyboxSystem`.
- Dev check: the result is compared with the domain's shared config in [../domains/configs.ts](../domains/configs.ts), the copy the server simulates on. Any differing keys are `console.error`ed.

`<Domain>` props: `terrain` (default true), `background` (scene background colour), `playerSpawn` (feet position, published to the persistent Player).

## How to use/add

These components are the API, not something you add more of. Everything is imported from `src/world/components`:

```tsx
import { Biome, Material, Region, Skybox } from "../../../../components";

export const MyRegion = () => (
  <Region spec={MY_REGION} biomes={{ mine: MyBiome }}>
    <Material shader={baseShader} textures={{ mybasetexture: "ground.png" }} />
    <Skybox topColor="#.." horizonColor="#.." bottomColor="#.." />
  </Region>
);

export const MyBiome = () => (
  <Biome spec={MY_BIOME}>
    <Material shader={fragmentShader} textures={{ mytexture: "rock.png" }} riverbed={{ texture: "dirt.png", saturation: 0.5 }} />
  </Biome>
);
```

Step-by-step recipes: new region / biome → [../domains/overworld/regions/README.md](../domains/overworld/regions/README.md). New domain → [../domains/README.md](../domains/README.md). New actor → [../../objects/actors/README.md](../../objects/actors/README.md).

To add a new scope-aware setting, add a field to `DomainStore` in [context.ts](context.ts), register it from the component, and read it in `commitDomain`. If the server needs it too, it belongs in the spec and must also go through [../domains/domainConfig.ts](../domains/domainConfig.ts).
