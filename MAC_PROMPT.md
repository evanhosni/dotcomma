# Mac test: terrain seam triangles (Apple M4)

You are Claude Code running on Evan's Mac (Apple M4, Metal). Test whether the fixes below, made on a Windows machine that cannot reproduce the bug, solved it. If they did not, undo them as described and debug the bug here, where it reproduces.

Don't stage or commit anything. Evan stages and ships everything himself.

## The bug

On the Mac only, in both Chrome and Firefox, rows of small dark triangles show through the terrain, along straight terrain-chunk seam lines. The triangles get bigger at more distant, lower-LOD seams; near a far snowy slope they form a checker pattern. This was never seen on Windows (NVIDIA, ANGLE D3D11). Evan hasn't tested on the Mac in a while, so we don't know which change introduced it.

The suspected cause is that they are SKIRT faces: the vertical strips hanging below each chunk's edge (src/world/terrain/chunkGeometry.ts). They show through:
- the T-junction gaps between a fine chunk and its coarser neighbour;
- sub-pixel cracks between neighbouring chunks.

They were shaded differently from the ground beside them.

## The changes made on Windows (rendering only; generated heights untouched)

1. **Skirts are shaded at their edge.**
   - `src/world/terrain/chunkGeometry.ts`: new static `skirtDrop` vertex attribute. It holds the skirt depth on the skirt's bottom ring and 0 everywhere else.
   - `src/world/shaders/vertex.glsl`: `shadePos = worldPos + vec3(0, skirtDrop, 0)` now feeds `vWorldUv`, `vWorldPosWrapped`, `vWorldPosAbs` and `vHeight`. Before, those used the skirt's own lowered position, so height-based paint (the mountain's snow line, triplanar mapping, lamp glow) shaded the skirt as different ground. `gl_Position` still uses the real position.
2. **`invariant gl_Position;`** in `src/world/shaders/vertex.glsl`. This makes the opaque terrain program and its LOD cross-fade twin place every vertex identically. Without it, fast-math compilers may disagree.
3. **Two new dev toggles, which stay either way** (Evan wants "tint skirts" kept):
   - `src/context/constants.ts`: `{ flag: "tintSkirts", label: "tint skirts" }` and `{ flag: "noLodFade", label: "no LOD fade" }` in `DEV_TOGGLES`.
   - `src/world/shaders/skirtTint.ts` (new): the shared uniform `uTintSkirts` and `SKIRT_TINT_GLSL`, which paints skirt faces magenta.
   - `src/utils/material/_material.ts`: adds that uniform to the terrain material and appends `SKIRT_TINT_GLSL` at the end of the terrain fragment shader.
   - `src/world/terrain/material.ts`: declares `varying float vSkirt`.
   - `vertex.glsl`: `vSkirt = skirtDrop > 0.0 ? 1.0 : 0.0`.
   - `src/world/terrain/TerrainRenderer.tsx`: wires both toggles. "tint skirts" sets `skirtTintUniform`; "no LOD fade" sets `swapper.fadeSeconds = 0`, so LOD swaps happen in one frame and the cross-fade dither is ruled out.
   - `src/world/terrain/README.md`: one line documenting the toggles.

## How to test

1. `npm run dev`, then open **http://localhost:3000**. Not :8080 and not dotcomma.io: those serve an old build without these changes.
2. Click to enter, then go to the desert and look across it toward the horizon (`window.__dotcomma.travelTo(-5888, 3234)` in the console is a good spot). Press **F1** for devmode, and tick **noclip** to fly up for a wide view.
3. **Are the dark triangles still there?** If not, the fix worked. Report that and stop.
4. If they are, tick **tint skirts**:
   - **The triangles turn magenta:** they are skirts. The shading fix didn't make them invisible; the remaining difference is likely the texture detail level (mip/LOD) Metal picks on a vertical face.
   - **They stay brown:** they are not skirts.
5. Untick it and tick **no LOD fade**. If the triangles vanish, the cause is the LOD cross-fade dither (`src/world/shaders/lodFade.ts`, `SCREEN_DOOR_GLSL` in `src/vfx/dither.ts`).

## If the bug persists: undo and debug here

Undo changes 1 and 2. Keep the dev toggles (change 3): the `skirtDrop` attribute and `vSkirt` stay, because the tint uses them.

- **In `vertex.glsl`:**
  - delete `invariant gl_Position;` and its comment;
  - delete the `shadeLift`/`shadePos` lines;
  - go back to `vWorldUv = worldPos.xz / 26.25;`, `vWorldPosWrapped = worldPos;`, `vWorldPosAbs = chunkOrigin + localWorld;` and `vHeight = worldPos.y;`.
- **Keep:** `vSkirt = skirtDrop > 0.0 ? 1.0 : 0.0;`.

Then reproduce it live and fix it at the root. Options, roughly by size:
- **Texture detail on vertical faces:** if the skirts turn magenta, shade them as a continuation of the ground outward so their texture coordinates vary like a slope, or force a texture LOD on skirt fragments.
- **Stitch T-junctions (the real fix):** snap each chunk's edge vertices onto its coarser neighbour's edge line, using per-side neighbour info, so there is never a gap to see through.
- **Bit-identical shared edges:** compute every chunk's edge vertices from a shared camera-relative origin instead of each chunk's own `modelViewMatrix[3]`. Respect the "Coordinate Precision" rules in CLAUDE.md: never form an absolute float32 world coordinate.
- **Something else entirely:** if the triangles are not magenta, also check the dotted light/dark specks along curved biome-blend lines. They are likely texture sampling inside the per-biome `if` branches of the terrain fragment shader, where screen-space derivatives are undefined, and Apple GPUs may render them much worse.

Verify any fix also keeps Windows unchanged:
- `npx tsc --noEmit`;
- `CI=true npm test -- --watchAll=false`;
- `src/world/terrain/lodSwaps.test.ts`, which guards the no-hole / no-double LOD cross-fade invariant.
