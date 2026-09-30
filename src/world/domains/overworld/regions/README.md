# Regions and biomes

Regions and biomes share this one README: a biome always lives inside a region's folder and is added through the region's files, so separate recipes would be half duplicates.

## How it works

The overworld is split into cells by two nested voronoi grids:
- **Region grid** (`regionGridSize` 3000): each region cell rolls one **region**.
- **Biome grid** (`gridSize` 500): inside it, each biome cell rolls one of that region's **biomes**.

The roll is `floor(u × count)` over the list, **in order**. So the order of [index.ts](index.ts)'s `OVERWORLD_REGIONS` and of each region spec's `biomes` decides what lands where, and every address depends on it.

| | a REGION owns | a BIOME owns |
|---|---|---|
| height | `baseNoise` (spec): broad relief shared by all its biomes | `noise` (spec): its own shape on top of the base, or `water` for a lake |
| look | a BASE material: `<Material shader textures>` from [`<region>/shaders/base.glsl`](city/shaders/base.glsl) | its own: `<Material shader textures>` from [`biomes/<b>/shaders/fragment.glsl`](city/biomes/grass/shaders/fragment.glsl) |
| sky | `<Skybox>`, mixed by position across region edges | optional `<Skybox>` override |
| content | — | `actors` (spec: everything that spawns in the biome, and only there), `<Dressing>`, `<Foliage>` |

**No hard edges.** At every wall between zones, height, material and sky all cross-fade into the neighbour (`utils/workers/zoneBlend.ts`; the long form is in CLAUDE.md "Blending"). Inside its `blendWidth` of an edge, a biome fades into its region's BASE material and base height (its "presence"). `blendWidth` / `heightBlendWidth` resolve biome → region → domain default (300). `blendWidth: 2` gives a crisp edge (the city). **Keep every width under 250** (half a biome cell), or presence never reaches 1 and the biome never fully appears.

**One list, rendered.** Everything the server needs is DATA in `spec.ts` (Three-free): id, name, flags, noise, blend widths, the biome order, and a biome's `actors`. The JSX never restates it:
- [../domain.tsx](../domain.tsx) renders `<Regions specs={OVERWORLD_REGIONS} components={{ city: CityRegion, … }}>`; [../config.ts](../config.ts) (the server's copy) is built from the same `OVERWORLD_REGIONS`.
- A `region.tsx` is `<Region spec biomes={{ <biome name>: Component }}>`: `<Region>` registers the spec (its `baseNoise` included) and renders the biome components **in `spec.biomes` order**.
- A `biome.tsx` is `<Biome spec>` + client-only children. `<Biome>` registers the spec (its `noise` included) and its `actors`.
- The component maps must have exactly one entry per spec name, and a `<Region>`/`<Biome>` must be the spec its parent's list put there; both throw in dev otherwise. A config-only biome maps to `null`.
- Ids and names are checked when the config is assembled ([../../domainConfig.ts](../../domainConfig.ts)): unique ids, unique names, names lowercase letters only (a name is the `/<region>/<biome>` address word and the `<name>_frag` shader function).

**Materials** ([src/utils/material/_material.ts](../../../../utils/material/_material.ts)): every region and biome is compiled into ONE terrain shader.
- Each file's `void main()` becomes `<name>_frag()` (biomes) or `<name>_base_frag()` (regions); its `uniform`/`varying` lines are stripped (declare what you use; the assembler declares it once).
- `textures` maps uniform names to files under `public/textures/`. **Uniform names and file-scope helper names are global across all shaders**: the same uniform name is allowed only for the same file (`sandtexture` is the desert base's AND the dust's `potato_sack.jpg`), and a helper defined twice (or clashing with `world/shaders/common.glsl`) throws in dev naming both owners — prefix helpers with the biome's name.
- At most **8 biomes per domain** (`MAX_BIOME_SLOTS`). The overworld uses 7. The shader is also near the 16-texture-unit limit (14 samplers today), so prefer reusing a texture file under its existing uniform name.
- For a material that needs non-texture uniforms, pass `getMaterial` (a `() => Promise<{ uniforms, fragmentShader }>`) instead of `shader` + `textures`.

Available varyings are declared in `world/shaders/vertex.glsl`: `vWorldUv`, `vSlopeAngle`, `vWorldNormal`, `vWorldPosWrapped`, `vHeight`, … Helpers in `world/shaders/common.glsl`: `triplanarSample`, `worldFbm`, `valueNoise`, `hash`. A world-space period read from `vWorldPosWrapped` must divide 4200.

Current regions (ids in each `spec.ts`; `world/constants.ts` keeps only the biome ids the pipeline and the tests look up):

| region | biomes | notes |
|---|---|---|
| `city` | `city`, `grass` | city heights are bespoke code (`utils/workers/roads/cityTerrain.ts`) |
| `desert` | `dust`, `salt` | |
| `snow` | `tundra`, `mountain` | shared `riverbed` in [snow/riverbed.ts](snow/riverbed.ts) |
| `ocean` | `lake` | an all-water region counts as the sea that rivers widen toward |

## How to use/add

> **Adding anything moves the map.** A new biome re-rolls every cell of its region. A new region re-rolls every region cell. Existing addresses then point to different places. Do it knowingly.

### Add a biome — 3 new files, 2 one-line edits (was 4 new files + 3 edits, + a config.ts flatten entry for pad actors)

1. **Create** `regions/<region>/biomes/fern/`:
   - `spec.ts`:
     ```ts
     import type { BiomeSpec } from "../../../../../../types";
     export const FERN_BIOME: BiomeSpec = {
       id: 9, name: "fern", joinable: true,   // id unique in the domain; name = lowercase letters
       // blendWidth: 150,          // optional, < 250
       noise: { params: { type: "perlin", octaves: 3, persistence: 1, lacunarity: 1,
                          exponentiation: 1, height: 80, scale: 150 } },
       // water: { depth: 20 },     // a lake instead of noise
       // prohibitRoads: true,      // no inter-city freeways on its walls
       // actors: [{ actor: ROCK_SPEC, density: 40 }],   // everything that spawns here, and only here — src/objects/actors/README.md
     };
     ```
     `noise` fields: `type` perlin|simplex, `height` (amplitude), `scale` (wavelength), plus optional `absNeg` (folded ridges) and `offset` (raise).
   - `shaders/fragment.glsl`: copy [desert/biomes/dust/shaders/fragment.glsl](desert/biomes/dust/shaders/fragment.glsl). Keep `void main()` and write `gl_FragColor`; declare the uniforms/varyings you use.
   - `biome.tsx`:
     ```tsx
     import { Biome, Material } from "../../../../../../components";
     import fragmentShader from "./shaders/fragment.glsl";
     import { FERN_BIOME } from "./spec";
     export const FernBiome = () => (
       <Biome spec={FERN_BIOME}>
         <Material shader={fragmentShader} textures={{ ferntexture: "fern.png" }} />
         {/* <Dressing>, <Foliage>, <Skybox> as needed — see src/objects */}
       </Biome>
     );
     ```
2. **Edit** the region's `spec.ts`: append `FERN_BIOME` to `biomes`.
3. **Edit** the region's `region.tsx`: add `fern: FernBiome` to its `biomes` map.
4. Optional: themed address nouns → [../README.md](../README.md).

### Add a region — 3 new files + its biomes, 2 one-line edits (was 4 new files + 4 edits, + a CRT page)

1. **Create** `regions/swamp/`:
   - `spec.ts`:
     ```ts
     import type { RegionSpec } from "../../../../types";
     import { FERN_BIOME } from "./biomes/fern/spec";
     export const SWAMP_REGION: RegionSpec = {
       id: 5, name: "swamp",       // unique id; name = lowercase letters (also the /swamp address)
       biomes: [FERN_BIOME],
       baseNoise: { type: "simplex", octaves: 2, persistence: 1, lacunarity: 2,
                    exponentiation: 1, height: 60, scale: 2000 },
       riverProbability: 0.5,
     };
     ```
   - `shaders/base.glsl`: copy [desert/shaders/base.glsl](desert/shaders/base.glsl). This is the plain ground every biome here fades into.
   - `region.tsx`:
     ```tsx
     import { Material, Region, Skybox } from "../../../../components";
     import { FernBiome } from "./biomes/fern/biome";
     import baseShader from "./shaders/base.glsl";
     import { SWAMP_REGION } from "./spec";
     export const SwampRegion = () => (
       <Region spec={SWAMP_REGION} biomes={{ fern: FernBiome }}>
         <Material shader={baseShader} textures={{ mudtexture: "mud.jpg" }} />
         <Skybox topColor="#6b7d5a" horizonColor="#b9c4a0" bottomColor="#4a4a3a" />
       </Region>
     );
     ```
   - Its biomes: "Add a biome" above, inside `regions/swamp/biomes/` (step 2 there is this `spec.ts`).
2. **Edit** [index.ts](index.ts): append `SWAMP_REGION` to `OVERWORLD_REGIONS` (config.ts and the CRT's address pages follow).
3. **Edit** [../domain.tsx](../domain.tsx): add `swamp: SwampRegion` to the `<Regions components>` map.
4. Optional: nouns for `swamp` in `REGION_NOUNS` ([../README.md](../README.md)).

The sky mix, blending, rivers, the server config and the `/swamp` CRT page all follow from the spec.

**Same biome in two regions:** copy the biome folder under the second region with a new component name, keep the same `id` (the commit merges registrations by id and throws in dev when two names share one), and re-export the original's spec (`export { FERN_BIOME } from "…/fern/spec"`). Caveats: foliage and dressing render once per copy, and the shader fades the biome into the base of only the FIRST region that lists it (`biomeSlotRegionsOf` in `utils/workers/zoneBlend.ts`).
