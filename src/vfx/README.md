# VFX

## How it works

World-wide visual effects, configured once per domain through `<PostProcessing>` and applied by the class bases, never per object.

- [PostProcessing.tsx](PostProcessing.tsx): a config carrier inside `<Domain>`; props `quantization`, `curvature`, `curvatureStart`, `fpsCap`, `pixelation`, each reset on unmount.
- [quantization.ts](quantization.ts) (`_quantization`): world-aligned vertex snapping of object-relative offsets (`setGridSize`, `QUANTIZE_GLSL`, `patchMaterial`).
- [curvature.ts](curvature.ts) (`_curvature`): the globe illusion — vertices past `uCurveStart` sink with horizontal camera distance (`CURVE_GLSL`, `curveViewPos`). Visual only; physics and placement stay flat; the sky is exempt.
- [spawnFade.ts](spawnFade.ts) (`_spawnFade`): objects dither in (and out) with a screen-door `discard` (`SCREEN_DOOR_GLSL`) over `DURATION`. Shared materials are drawn through per-fade twin views carrying their own `uSpawnFade`. `SpawnFade`, `SpawnFadeSet`.
- [underwater.ts](underwater.ts) (`UnderwaterPass`): while the camera is under water (`setCameraWaterDepth`, written by the Player), CustomCanvas's `SceneRender` draws the scene into a target and back through one full-screen pass: a wobble, a blur that widens with distance and depth-buffer fog toward the water's color (lit from above, darker with the camera's depth and at night). It covers every object class without patching a material. The target is flagged `isXRRenderTarget` with an sRGB texture so three keys every program exactly as for the screen: a plain target would have linked a second program for every material on the first dive.
- [frameCap.ts](frameCap.ts): skips presented frames only (`shouldPresentThisFrame`); `isMainRenderFrame` is for render-to-texture work, never gameplay.
- [dither.ts](dither.ts): `ditherGLSL` breaks up gradient banding.
- [materialPatch.ts](materialPatch.ts): `chainMaterialPatch`, how every patcher adds its shader edit without dropping another one's (it chains `onBeforeCompile` and extends the program cache key).

Effects reach materials through `prepareActorMaterial`, `prepareDressingMaterial`, the foliage shader, and the terrain/water shaders. Each `patchMaterial` is idempotent and goes through `chainMaterialPatch`.

The sprite tier's base material (`objects/sprite-lod/spriteMaterial.ts`) is a call site too: it takes curvature, and deliberately not quantization (a flat billboard has nothing to snap) nor lamp glow (wrong on a far stand-in). Its fade is its own screen-door dither, complementary to the actors' spawn fade.

## How to add another

1. Create `vfx/<effect>.ts` with its uniform, GLSL and an idempotent `patchMaterial` built on `chainMaterialPatch` ([curvature.ts](curvature.ts) is the template).
2. Add a prop to `PostProcessing` that sets it and resets it on unmount.
3. Call the patcher from the class bases (`prepareActorMaterial`, `prepareDressingMaterial`, the foliage shader, the sprite material, unless it is wrong for a far billboard) and the terrain/water shaders — not from individual objects.
