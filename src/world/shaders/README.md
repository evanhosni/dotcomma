# Shaders (terrain)

## How it works

The whole terrain is drawn with ONE `ShaderMaterial`. Its fragment shader is generated at domain
commit from every region's base shader and every biome's shader. Biomes are blended per pixel;
the shader contains no biome id and no per-triangle switch.

**Files**
- [`vertex.glsl`](vertex.glsl): the shared terrain vertex shader. It passes the per-vertex attributes
  from the terrain worker through as varyings. It computes the world position as a WRAPPED chunk
  origin plus a chunk-local offset (never an absolute float32 coordinate; see CLAUDE.md "Coordinate
  Precision"), applies quantization and curvature, and projects through the view-space origin.
- [`common.glsl`](common.glsl): helpers available to every fragment: `hash`, `valueNoise`,
  `worldFbm(xz, scale, octaves)` (repeats with `WORLD_WRAP`) and `triplanarSample`.
- [`constants.ts`](constants.ts): `WORLD_WRAP` (4200), `glslFloat`, and the off-city freeway corridor's
  extent (`FREEWAY_CORRIDOR_INNER`/`OUTER`, 8 and 9.5 street units — the road-fragment pass reads it too).
- [`world/terrain/material.ts`](../terrain/material.ts): `getMaterial()`. It prepends the quantization
  and curvature GLSL chunks (`vfx/quantization.ts`, `vfx/curvature.ts`) to
  `vertex.glsl`, loads the river and riverbed textures, sets the `defines` (`WORLD_WRAP`,
  `ROAD_HALF_WIDTH`, `FREEWAY_HALF_WIDTH`, `RIVER_HALF_WIDTH`, `RIVER_BED_REACH`, all taken from
  the active `TerrainParams`) and checks that the biome slot order matches the worker's.
- [`utils/material/_material.ts`](../../utils/material/_material.ts): `loadTextures` (from
  `public/textures/`, repeat-wrapped), `fromShader` (what `<Material shader textures>` uses) and
  `combineBiomeMaterials`, the generator.

**What the generated fragment shader does**
1. Each biome's and region's `fragmentShader` has its `uniform` and `varying` lines stripped, and
   its `void main() {` renamed to `<biome.name>_frag()` or `<region.name>_base_frag()`. All uniforms
   are merged into one map, so a uniform name must mean the same texture in every shader that
   uses it.
2. Per biome slot k, `vBiomeSdf0/1[k]` is a signed distance, and `smoothstep(-1, 1, sdf)` gives its
   weight. Weights combine in crispness tiers (crispest `blendWidth` first), mirroring the
   worker's `combineSlotWeights`. A biome whose weight is below 0.002 is not evaluated at all.
3. A biome's color is its region's base frag faded into its own frag by its presence
   (`vBiomePresence0/1[k]`), so the base texture shows at every biome edge.
4. Riverbed: within `RIVER_BED_REACH` of a river, each biome's riverbed texture (its
   `<Material riverbed>`, else the domain's river texture) replaces the ground. City pavement is
   the exception and stays.
5. Road corridor: wherever `vDistanceToRoadCenter < FREEWAY_CORRIDOR_OUTER` (9.5), the CITY biome's
   own frag paints over the result. This is how inter-city freeways get the same asphalt as city roads.
6. Night dim, lamp-grid glow (from `vWorldPosAbs`), the scene point lights (a lambert loop gated on
   the night blend) and dither.

**Varyings a biome shader may read:** `vUv`, `vWorldUv` (world xz / 26.25, one texture tile per
unit), `vWorldPosWrapped`, `vWorldPosAbs` (lighting lookups only), `vWorldNormal`, `vSlopeAngle`
(0 flat → 1 vertical), `vHeight`, `vDistanceToRoadCenter` (normalized street units),
`vDistanceToFreewayCenter`, `vFreewayAlong`, `vRiverBedDistance`. Shared uniforms:
`uNightBlend` and the lamp-grid uniforms.

## How to use/add

**Write a biome's (or region base's) fragment shader:**
1. Create `shaders/fragment.glsl` (a region's base uses `shaders/base.glsl`) in the biome's folder:
   ```glsl
   uniform sampler2D mybiometexture;   // unique name unless it is the SAME texture elsewhere
   varying vec2 vWorldUv;
   varying float vSlopeAngle;
   varying vec3 vWorldNormal;
   varying vec3 vWorldPosWrapped;

   void main() {
     vec4 base = texture2D(mybiometexture, fract(vWorldUv));
     float tri = smoothstep(0.3, 0.6, vSlopeAngle);
     gl_FragColor = mix(base, triplanarSample(mybiometexture, vWorldPosWrapped, vWorldNormal, 1.0 / 26.25), tri);
   }
   ```
   Write the line exactly as `void main() {`, because that exact string is what gets renamed.
   Write only this biome's own surface, with no edge or neighbor logic.
2. Mount it inside the `<Biome>` (or `<Region>`), naming each sampler's file in `public/textures/`:
   ```tsx
   import fragmentShader from "./shaders/fragment.glsl";
   <Material shader={fragmentShader} textures={{ mybiometexture: "my_texture.jpg" }} />
   ```
   Optionally add `riverbed={{ texture, tint?, saturation? }}` on a biome to give it its own
   riverbed. (A material with non-texture uniforms passes `getMaterial` instead.)

**Rules:**
- Any new world-space period read from `vWorldPosWrapped` must divide 4200. For noise, use
  `worldFbm`.
- A domain can have at most 8 biomes (`MAX_BIOME_SLOTS` in `world/terrain/material.ts`).
- The shader is close to 16 texture units, so reuse textures where you can.
