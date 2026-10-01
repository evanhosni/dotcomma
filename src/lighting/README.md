# Lighting

## How it works

- **Day/night** ([dayNight.ts](dayNight.ts)): module-level channels written every frame by [world/sky/DayNightCycle.tsx](../world/sky/DayNightCycle.tsx) from the server clock via `nightBlendAt`. Read them from `useFrame`:
  - `getNightBlend()` — day-to-night blend;
  - `getWindowLightsProgress()` — drives window lights and lamp glow;
  - `getNightIndex()` — changes each nightfall so different windows light;
  - `NIGHT_BLEND_UNIFORM` + `nightDimGLSL()` (darkens by `NIGHT_GROUND_DIM`) for unlit shaders.
- **Scene lights** ([DayNightLights.tsx](DayNightLights.tsx)): one ambient and one directional light, dimmed by the blend; the directional swings from sun to moon. Only lit materials see them.
- **Lamp glow** ([lampGlow.ts](lampGlow.ts)): street lamps and signals light the ground with no real lights.
  - Each source is a `LampHead` (position + index into `LAMP_COLORS`) in `activeLampHeads`.
  - The heads are periodically written into a camera-centered grid texture of `LAMP_CELL_SIZE` cells, one head per cell.
  - Shaders sample their neighboring cells (`lampGlowAccumGLSL`) with falloff `LAMP_GLOW_RADIUS`, so cost is constant for any lamp count.
  - `LampGlowDriver` (in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) runs `driveLampLighting`; intensity follows `getWindowLightsProgress()`.
  - Receivers: terrain, every actor material (`patchStandardMaterialLampGlow` via `prepareActorMaterial`), bridge decks.

## How to add another

- **Glow source**: call `registerLampHeads("<key>", heads)` when the heads exist and call its returned disposer when they go away (see `street-lamps`). Recolor with `setLampHeadColor`.
- **Glow color**: append `{ name, rgb }` to `LAMP_COLORS` (never reorder), and optionally `export const LAMP_COLOR_<NAME> = lampColorIndex("<name>")`.
- **Glow receiver**:
  - `MeshStandardMaterial`: `patchStandardMaterialLampGlow(material)`.
  - `ShaderMaterial`: spread `LAMP_GRID_UNIFORMS` into its uniforms, add `LAMP_GLOW_UNIFORMS_GLSL` to the fragment declarations, use `lampGlowAccumGLSL("<absolute world pos>")` and add `lampGlowSum` (see [bridges/deckMaterial.ts](../objects/dressing/bridges/deckMaterial.ts)).
