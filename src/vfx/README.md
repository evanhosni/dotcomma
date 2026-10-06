# VFX

## How it works

World-wide visual effects, configured once per domain through `<PostProcessing>` and applied by the class bases, never per object.

- [PostProcessing.tsx](PostProcessing.tsx): a config carrier inside `<Domain>`; props `quantization`, `curvature`, `curvatureStart`, `fpsCap`, `pixelation`, each reset on unmount.
- [quantization.ts](quantization.ts) (`_quantization`): world-aligned vertex snapping of object-relative offsets (`setGridSize`, `QUANTIZE_GLSL`, `patchMaterial`).
- [curvature.ts](curvature.ts) (`_curvature`): the globe illusion — vertices past `uCurveStart` sink with horizontal camera distance (`CURVE_GLSL`, `curveViewPos`). Visual only; physics and placement stay flat; the sky is exempt.
- [spawnFade.ts](spawnFade.ts) (`_spawnFade`): objects dither in (and out) with a screen-door `discard` (`SCREEN_DOOR_GLSL`) over `DURATION`. Shared materials are drawn through per-fade twin views carrying their own `uSpawnFade`. `SpawnFade`, `SpawnFadeSet`.
- [frameCap.ts](frameCap.ts): skips presented frames only (`shouldPresentThisFrame`); `isMainRenderFrame` is for render-to-texture work, never gameplay.
- [dither.ts](dither.ts): `ditherGLSL` breaks up gradient banding.
- [materialPatch.ts](materialPatch.ts): `chainMaterialPatch`, how every patcher adds its shader edit without dropping another one's (it chains `onBeforeCompile` and extends the program cache key).

Effects reach materials through `prepareActorMaterial`, `prepareDressingMaterial`, the foliage shader, and the terrain/water shaders. Each `patchMaterial` is idempotent and goes through `chainMaterialPatch`.

## How to add another

1. Create `vfx/<effect>.ts` with its uniform, GLSL and an idempotent `patchMaterial` built on `chainMaterialPatch` ([curvature.ts](curvature.ts) is the template).
2. Add a prop to `PostProcessing` that sets it and resets it on unmount.
3. Call the patcher from the class bases (`prepareActorMaterial`, `prepareDressingMaterial`, the foliage shader) and the terrain/water shaders — not from individual objects.
