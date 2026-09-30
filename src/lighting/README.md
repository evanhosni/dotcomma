# Lighting

## How it works

**Day/night state** ([dayNight.ts](dayNight.ts)) is a set of module-level channels. [sky/DayNightCycle.tsx](../world/sky/DayNightCycle.tsx) writes them from the server clock every frame, and everything else reads them:

| read with | meaning |
|---|---|
| `getNightBlend()` | 0 = full day, 1 = full night |
| `getDayNightPhase()` | `"day" \| "dusk" \| "night" \| "dawn"` |
| `getWindowLightsProgress()` | 0..1. Ramps on after mid-dusk and off at dawn. Drives window lights, lamp emissive and lamp glow |
| `getNightIndex()` | increments each nightfall, so a different set of windows lights each night |
| `NIGHT_BLEND_UNIFORM` | the same blend as a shared shader uniform (`uNightBlend`) for unlit shaders; `nightDimGLSL()` darkens by `NIGHT_GROUND_DIM` |

- `nightBlendAt(timeMs, dayMs, nightMs, transitionMs)` is the cycle curve itself (pure; DayNightCycle feeds it the server clock).
- There is no React context for day/night: read the getters above from `useFrame`.
- [DayNightLights.tsx](DayNightLights.tsx) is the scene's ambient light plus one directional light. Both dim with the blend, and the directional light swings from the sun to the moon. Only LIT materials (actors, buildings, dressing) see these lights. Unlit terrain and grass dim through `uNightBlend` instead.

**Lamp glow** ([lampGlow.ts](lampGlow.ts)) is how street lamps and traffic signals light the ground at night. It uses **no real lights**:

- Every glow source is a `LampHead` (`position`, `color` = an index into `LAMP_COLORS`) in the `activeLampHeads` map.
- Every ~20 frames the heads are written into a 64×64 **grid texture** centered on the camera. Each cell is 24u (`LAMP_CELL_SIZE`) and holds one head. If two heads share a cell, the first one registered wins.
- Shaders read their 3×3 cell neighborhood (`lampGlowAccumGLSL`) and add a falloff of radius `LAMP_GLOW_RADIUS`. The cost is the same for any number of lamps.
- Intensity follows `getWindowLightsProgress()`, so lamps come on with the windows.
- `LampGlowDriver` (mounted once in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) runs `driveLampLighting` every frame while any head is registered. `driveLampLighting` is time-guarded, so the features that still call it themselves cost nothing extra.
- Who receives the glow: the terrain (built into its material), every actor material (`prepareActorMaterial` calls `patchStandardMaterialLampGlow`), and bridge decks (they add `LAMP_GLOW_UNIFORMS_GLSL` + `lampGlowAccumGLSL` by hand).

## How to use/add

### Add a glow source

One call when the heads exist, and its disposer when they go away:

```ts
import { LAMP_COLOR_WARM, registerLampHeads } from "../../../lighting/lampGlow";

const disposeHeads = registerLampHeads("my-feature", [
  { position: new THREE.Vector3(x, y + 5, z), color: LAMP_COLOR_WARM },
]);
// With the dressing base: keep it on the chunk → useChunkRegistry((chunk) => chunk.disposeHeads()).
```

Keys are generated, the grid is marked dirty, and the driver is already running. To recolor a head, call `setLampHeadColor(head, color)`, which marks the grid dirty.

[street-lamps](../objects/dressing/street-lamps/StreetLamps.tsx) and [traffic-lights](../objects/dressing/traffic-lights/TrafficLights.tsx) still use the older hand-keyed API (`activeLampHeads.set` + `markLampGridDirty` + `unregisterLampHeads` + their own `driveLampLighting`). It keeps working, but don't copy it.

### Add a glow color

Append `{ name, rgb }` to `LAMP_COLORS` in [lampGlow.ts](lampGlow.ts) (heads store the index, so never reorder), plus `export const LAMP_COLOR_<NAME> = lampColorIndex("<name>")` if code needs to name it. The shader's color selection is generated from the list.

### Make a custom shader receive glow

- Lit `MeshStandardMaterial`: call `patchStandardMaterialLampGlow(material)`. Actors already get this through `prepareActorMaterial`.
- `ShaderMaterial`: spread `LAMP_GRID_UNIFORMS` into its uniforms and put `${LAMP_GLOW_UNIFORMS_GLSL}` in the fragment shader's declarations. Then use `${lampGlowAccumGLSL("<absolute world pos>")}` and add `lampGlowSum`. Pass the ABSOLUTE world position, not a wrapped one. See [bridges/deckMaterial.ts](../objects/dressing/bridges/deckMaterial.ts).

### Knobs

- Ambient/directional strength by day and night: the constants at the top of [DayNightLights.tsx](DayNightLights.tsx).
- How dark unlit ground gets: `NIGHT_GROUND_DIM` in [dayNight.ts](dayNight.ts).
- Glow reach: `LAMP_GLOW_RADIUS`. Keep it ≤ `LAMP_CELL_SIZE`.
