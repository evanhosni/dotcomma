# VFX

## How it works

These are world-wide visual effects. Each one is set **once per domain** through `<PostProcessing>` and applied to materials by the class bases, not per object.

- **[PostProcessing.tsx](PostProcessing.tsx)** is a config carrier mounted inside a `<Domain>`. Each prop writes a module-level uniform or setting, and every one resets on unmount, so a domain never inherits the previous one's effects:
  - `quantization`: world-aligned vertex snapping grid in world units (the overworld uses `0.025`). The implementation is [quantization.ts](quantization.ts): it snaps object-relative offsets, so it stays exact far from the origin (`patchMaterial`, `setGridSize`, `QUANTIZE_GLSL`).
  - `curvature` / `curvatureStart`: the "walking on a globe" illusion. **Off unless set.** The overworld doesn't set it today.
  - `fpsCap`: caps presented frames only.
  - `pixelation`: optional screen-space pixelation (the only real post-processing pass, `@react-three/postprocessing`).
- **[curvature.ts](curvature.ts)** sinks every vertex farther than `uCurveStart` from the camera by `(d − start)² / 2R`, measured on HORIZONTAL distance and along world down. It is a vertex effect, so depth and occlusion stay correct. Physics, raycasts and placement stay flat. It is applied in exactly five places: the terrain vertex shader, the water shader ([world/water/waterMaterial.ts](../world/water/waterMaterial.ts)), the foliage shader, `prepareActorMaterial` ([objects/actors/Actor.tsx](../objects/actors/Actor.tsx)) and `prepareDressingMaterial` ([objects/dressing/Dressing.tsx](../objects/dressing/Dressing.tsx)). The sky is deliberately exempt.
- **[frameCap.ts](frameCap.ts)** skips `gl.render` on off-cadence ticks. The rAF loop and every `useFrame` still run at display rate, so gameplay timing is unaffected. `SceneRender` in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx) calls `shouldPresentThisFrame()` once per tick. Use `isMainRenderFrame()` only for render-to-texture work, never for gameplay.
- **[dither.ts](dither.ts)** `ditherGLSL(target)` adds ±0.5/255 screen-space noise so slow gradients don't band. It is used by the sky, the terrain, the water, bridge decks and the city light aura.

Material patchers (`_curvature.patchMaterial`, `_quantization.patchMaterial`) are idempotent and chain `onBeforeCompile`, so they can be applied in any order alongside the lamp-glow patch.

## How to use/add

### Turn an effect on for a domain

Edit the domain's `<PostProcessing>` (e.g. [overworld/domain.tsx](../world/domains/overworld/domain.tsx)):

```tsx
<PostProcessing quantization={0.025} curvature={20000} curvatureStart={100} fpsCap={60} />
```

At `curvature={20000}` the ground drops 4u at 500u away, 20u at 1000u and 90u at 2000u. Keep every interaction reach (doors 6u, the CRT 14u) inside `curvatureStart`.

### Make a new kind of object curve/quantize

Build it on its class base (actor / dressing / foliage). Then it gets these effects without extra code. Only a brand-new custom shader outside those bases needs `_curvature.patchMaterial(material)`, or `CURVE_GLSL` + `curveViewPos(viewPos)` for a hand-written vertex shader.

### Add a new world-wide effect

1. Put the uniform + GLSL + an idempotent, chaining `patchMaterial` in a new file here. [curvature.ts](curvature.ts) is the template.
2. Add a prop to `PostProcessing` that sets it and resets it on unmount.
3. Call the patcher from the five places listed above. Don't call it from individual objects.
