import { SCREEN_DOOR_GLSL } from "../../vfx/dither";

/** LOD cross-fade (world/terrain/lodSwaps.ts): the per-mesh dither range uniform, and the define that
 *  compiles the terrain's fade twin (world/terrain/material.ts createLodFadeMaterial). */
export const LOD_FADE_UNIFORM = "uLodFade";
export const LOD_FADE_DEFINE = "TERRAIN_LOD_FADE";

/** A mesh keeps the pixels whose screen-door threshold lies in its [range.x, range.y). The old and
 *  new chunks of a swap hold complementary ranges of this ONE threshold, so each pixel is drawn by
 *  exactly one of them. The same 4×4 Bayer pattern as the objects' spawn fade (vfx/spawnFade.ts). */
export const LOD_FADE_GLSL = /* glsl */ `
  ${SCREEN_DOOR_GLSL}
  bool lodFadeDiscards(vec2 range) {
    float h = screenDoorThreshold(gl_FragCoord.xy);
    return h < range.x || h >= range.y;
  }
`;
