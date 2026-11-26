# Terrain shaders

## How it works

The terrain is ONE `ShaderMaterial` whose fragment shader is generated at domain commit from every region's base shader and every biome's shader. Biomes blend per pixel; there is no biome id in the shader.

- [vertex.glsl](vertex.glsl): passes the worker's per-vertex attributes through as varyings; builds world position as a wrapped chunk origin plus a local offset (never an absolute float32 coordinate); applies quantization and curvature.
- [common.glsl](common.glsl): helpers for every fragment: `hash`, `valueNoise`, `worldFbm`, `triplanarSample`, `slopeBlendedSample` (the flat texture read fading into a triplanar one on steep ground), `quadGate` (THE gate for any texture sample behind a branch: the same for the whole 2×2 quad, so mip derivatives stay defined) and `fakeSunLight` (the unlit ground's directional shade).
- [material.ts](material.ts): the shared GLSL chunks and their uniforms:
  - `lodFadeDiscards`, the LOD cross-fade screen door.
  - `lodBlur` and `blurStep`, the paint edges softening with the LOD rings' vertex spacing (terrain/DECISIONS.md §9). A biome frag may read `lodBlur` (world units) and call `blurStep` for any edge on an interpolated field.
  - `farFadeDiscards`, the ground's far fade. Terrain and water dither out over the last `FAR_FADE_FRACTION` (72%, [constants.ts](constants.ts)) of the LIVE `camera.far`, measured as the horizontal camera distance (`vFarDistance`, taken in the vertex stage before curvature). Both fades share one `SCREEN_DOOR_GLSL` per shader.
  - `tunnelRockColor` / `tunnelShade`, the cave rock formula the cave walls and the terrain's ENTRANCE variant both draw.
  - `CHUNK_PROJECTION_GLSL` (`projectChunkLocal`), the vertex stage every chunk-relative custom program shares with vertex.glsl — wrapped chunk origin + local offset, quantized, projected through `modelViewMatrix[3]`, curved — and `CHUNK_PROJECTION_UNIFORMS`; the rocks, the snow sheet and the tunnels build on it.
- [terrain-holes/](terrain-holes/material.ts): `terrainHoleDiscards` ([material.ts](terrain-holes/material.ts)), the tunnels' per-pixel openings (manhole shafts, cave mouth footprints by the entrance fade's share) and the skirt masks over tunnel air; shared uniform objects (set through [store.ts](terrain-holes/store.ts)), compiled only into the terrain's discard variant ([../terrain/material.ts](../terrain/material.ts)).
- [constants.ts](constants.ts): `WORLD_WRAP`, `TERRAIN_TEXTURE_TILE`, `FREEWAY_CORRIDOR_INNER`/`FREEWAY_CORRIDOR_OUTER`, the riverbed paint's insets and `RIVER_BED_UNDERWATER_FADE` (its slope yield is each biome's `<Material riverbed={{ yieldSlope }}>`); `glslFloat` is in [utils.ts](utils.ts).
- [../terrain/material.ts](../terrain/material.ts) (`getMaterial`): prepends the quantization/curvature chunks and sets the `defines` (`WORLD_WRAP`, `TEXTURE_TILE`, `ROAD_HALF_WIDTH`, `FREEWAY_HALF_WIDTH`, `RIVER_HALF_WIDTH`, `RIVER_BED_REACH`).
- [biome-materials/index.ts](biome-materials/index.ts) generates the fragment shader:
  1. Strips each shader's `uniform`/`varying` lines and renames `void main() {` to `<name>_frag()` / `<name>_base_frag()`.
  2. Weights each biome slot from its signed distance (`vBiomeSdf0/1`) in crispness tiers (mirrors `combineSlotWeights`).
  3. Fades each biome into its region's base by presence (`vBiomePresence0/1`): the weights first (each slot's split between its base and its own frag), then every base and every frag CALLED ONCE with its summed weight — one call site per slot inlined a shared base 2–3 times into each terrain program (Firefox link time).
  4. Paints the riverbed near rivers, then the city's frag over the road corridor (`vDistanceToRoadCenter`; the mix keeps it in `cityColor`).
  5. Applies night dim, lamp glow, point lights and dither.

## How to add another

1. Create `shaders/fragment.glsl` in the biome folder (`shaders/base.glsl` for a region base). Declare the uniforms/varyings you use (from [vertex.glsl](vertex.glsl)), write exactly `void main() {`, and draw only the biome's own surface into `gl_FragColor`.
2. Mount it: `<Material shader={fragmentShader} textures={{ mytexture: "file.jpg" }} />` (files in `public/textures/`; optional `riverbed` on a biome).
3. Keep uniform/helper names unique unless they mean the same thing; any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (use `worldFbm` for noise, `1.0 / TEXTURE_TILE` for the texture tile).
