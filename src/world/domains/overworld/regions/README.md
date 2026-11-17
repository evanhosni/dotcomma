# Regions and biomes

## How it works

One folder per region, one per biome inside it, each with a `<Name>Region.tsx` / `<Name>Biome.tsx`
holding its tree and a `shaders/` folder holding its GLSL. The folder hierarchy IS the content hierarchy.

```
regions/
  city/
    CityRegion.tsx       <Region id={1} name="city"> … its biomes
    shaders/base.glsl    its BASE material — what its biomes fade into at their edges
    biomes/
      city/
        CityBiome.tsx    <Biome id={1} name="city"> … everything true of it
        shaders/fragment.glsl
        CityLights.tsx   code only this biome uses lives here
      grass/…
```

The four regions and what makes each: **city** (city + grass on the default base, rivers 0.35),
**desert** (dust, oasis and salt on their own simplex base, 0.03; the oasis is dust's relief in paler sand, dry, with rare springs; salt has no `<Material>`, so it draws the base), **snow** (tundra + mountain on a slow
perlin base, 0.55), **ocean** (lake biomes on a near-flat base, 0.6).

**JSX order is VORONOI order.** The region roll is `floor(u × count)` over the `<Region>` children
of the domain, and the biome roll a cumulative pick over the `<Biome>` children of each region, each
taking its `weight` (default 1; all 1 is exactly `floor(u × count)`).

**A biome that is another's relief with something more** (the oasis: dust's dunes + springs, no
rivers) copies its `<Noise>` literal: two joinable biomes with the same one are ONE relief, so their
shared walls do not sink to the region base (`generation/zones/blend/index.ts` `joinReliefs`). Its texture may reuse the
other's uniform name for the same file; its own frag must tell it apart (the oasis's sand is paler), or the cells are invisible.
A biome with no `<Material>` draws its region's BASE (`combineBiomeMaterials`: the salt flats).

## How to add a biome

1. `biomes/<name>/shaders/fragment.glsl` — a `void main()` writing `gl_FragColor`. Its uniform and
   varying lines are stripped; sampler uniform names are GLOBAL across every biome shader (the
   terrain is one material), so reuse a name only for the same file.
2. `biomes/<name>/<Name>Biome.tsx`:
   ```tsx
   export const MyBiome = content(
     <Biome id={9} name="myname" joinable blendWidth={150}>
       <Material shader={fragmentShader} textures={{ mytexture: "my.png" }} />
       <Noise params={{ … }} />
       {/* whatever is true of it: <Snow/>, <Rocks/>, <Caves>, <StreetLamps/>, <Actor/>, … */}
     </Biome>,
   );
   ```
3. One line in its region's `<Name>Region.tsx`: `<MyBiome />`.

The id and the name must be unique in the domain; the name is lowercase letters only (it is an
address word and a shader function name).

## How to add a region

The same, one level up: `<Region id name>` with a `<Material>` (its base), a `<Noise>`, a
`<Skybox>`, a `<Rivers chance>` if it has any (a biome may mount its own to override it; `chance={0}` = dry), a `<Pond riverEnd>` if its rivers should end in ponds (none: they all end round), and its biomes, in `regions/<name>/<Name>Region.tsx` (+ `shaders/base.glsl`). Then one line in the domain's tree (`OverworldDomain.tsx`).

## Hazard

**Adding or reordering either MOVES THE MAP** — every cell of that grid re-rolls and every address
anyone has linked to points somewhere else. To move less, insert a biome in the MIDDLE with a small
`weight`: only the cells it takes change (the oasis, `weight={0.25}` between dust and salt, took 11.0%
of the desert's cells, half from each, and nothing else). A new biome needs its 16 address nouns
(`BIOME_NOUNS` in `world/domains/overworld/address/constants.ts`), and the terrain has 8 shader slots (`MAX_BIOME_SLOTS`): all 8 are used.
