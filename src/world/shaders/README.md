# Terrain shaders

## How it works

The terrain is ONE `ShaderMaterial` whose fragment shader is generated at domain commit from every region's base shader and every biome's shader. Biomes blend per pixel; there is no biome id in the shader.

- [vertex.glsl](vertex.glsl): passes the worker's per-vertex attributes through as varyings; builds world position as a wrapped chunk origin plus a local offset (never an absolute float32 coordinate); applies quantization and curvature.
- [common.glsl](common.glsl): helpers for every fragment: `hash`, `valueNoise`, `worldFbm`, `triplanarSample`, `slopeBlendedSample` (the flat texture read fading into a triplanar one on steep ground) and `fakeSunLight` (the unlit ground's directional shade).
- [lodFade.ts](lodFade.ts): `lodFadeDiscards`, the LOD cross-fade screen door.
- [farFade.ts](farFade.ts): `farFadeDiscards`, the ground's far fade. Terrain and water dither out over the last `FAR_FADE_FRACTION` (72%, [constants.ts](constants.ts)) of the LIVE `camera.far`, measured as the horizontal camera distance (`vFarDistance`, taken in the vertex stage before curvature). Both fades share one `SCREEN_DOOR_GLSL` per shader.
- [constants.ts](constants.ts): `WORLD_WRAP`, `TERRAIN_TEXTURE_TILE`, `glslFloat`, `FREEWAY_CORRIDOR_INNER`/`FREEWAY_CORRIDOR_OUTER`, `RIVER_BED_SLOPE_START_DEG`/`RIVER_BED_SLOPE_END_DEG`.
- [../terrain/material.ts](../terrain/material.ts) (`getMaterial`): prepends the quantization/curvature chunks and sets the `defines` (`WORLD_WRAP`, `TEXTURE_TILE`, `ROAD_HALF_WIDTH`, `FREEWAY_HALF_WIDTH`, `RIVER_HALF_WIDTH`, `RIVER_BED_REACH`).
- [combineBiomeMaterials.ts](combineBiomeMaterials.ts) generates the fragment shader:
  1. Strips each shader's `uniform`/`varying` lines and renames `void main() {` to `<name>_frag()` / `<name>_base_frag()`.
  2. Weights each biome slot from its signed distance (`vBiomeSdf0/1`) in crispness tiers (mirrors `combineSlotWeights`).
  3. Fades each biome into its region's base by presence (`vBiomePresence0/1`).
  4. Paints the riverbed near rivers, then the city's frag over the road corridor (`vDistanceToRoadCenter`).
  5. Applies night dim, lamp glow, point lights and dither.

## How to add another

1. Create `shaders/fragment.glsl` in the biome folder (`shaders/base.glsl` for a region base). Declare the uniforms/varyings you use (from [vertex.glsl](vertex.glsl)), write exactly `void main() {`, and draw only the biome's own surface into `gl_FragColor`.
2. Mount it: `<Material shader={fragmentShader} textures={{ mytexture: "file.jpg" }} />` (files in `public/textures/`; optional `riverbed` on a biome).
3. Keep uniform/helper names unique unless they mean the same thing; any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (use `worldFbm` for noise, `1.0 / TEXTURE_TILE` for the texture tile).
