# Regions and biomes

## How it works

One folder per region, one per biome inside it, each with an `index.tsx` holding its tree and a
`shaders/` folder holding its GLSL. The folder hierarchy IS the content hierarchy.

```
regions/
  city/
    index.tsx            <Region id={1} name="city"> … its biomes
    shaders/base.glsl    its BASE material — what its biomes fade into at their edges
    biomes/
      city/
        index.tsx        <Biome id={1} name="city"> … everything true of it
        shaders/fragment.glsl
        lights.tsx       code only this biome uses lives here
      grass/…
```

The four regions and what makes each: **city** (city + grass on the default base, rivers 0.35),
**desert** (dust + salt on their own simplex base, 0.15), **snow** (tundra + mountain on a slow
perlin base, 0.55), **ocean** (lake biomes on a near-flat base, 0.6).

**JSX order is VORONOI order.** The region roll is `floor(u × count)` over the `<Region>` children
of the domain, and the biome roll over the `<Biome>` children of each region.

## How to add a biome

1. `biomes/<name>/shaders/fragment.glsl` — a `void main()` writing `gl_FragColor`. Its uniform and
   varying lines are stripped; sampler uniform names are GLOBAL across every biome shader (the
   terrain is one material), so reuse a name only for the same file.
2. `biomes/<name>/index.tsx`:
   ```tsx
   export const MyBiome = content(
     <Biome id={9} name="myname" joinable blendWidth={150}>
       <Material shader={fragmentShader} textures={{ mytexture: "my.png" }} />
       <Noise params={{ … }} />
       {/* whatever is true of it: <Snow/>, <Rocks/>, <Caves>, <StreetLamps/>, <Actor/>, … */}
     </Biome>,
   );
   ```
3. One line in its region's `index.tsx`: `<MyBiome />`.

The id and the name must be unique in the domain; the name is lowercase letters only (it is an
address word and a shader function name).

## How to add a region

The same, one level up: `<Region id name>` with a `<Material>` (its base), a `<Noise>`, a
`<Skybox>`, a `<Rivers chance>` if it has any, and its biomes. Then one line in the domain's tree.

## Hazard

**Adding or reordering either MOVES THE MAP** — every cell of that grid re-rolls and every address
anyone has linked to points somewhere else.
