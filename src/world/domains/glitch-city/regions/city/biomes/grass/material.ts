/**
 * The city region's grass biome shares biome id 3 with the grass region's
 * GrassBiome; registrations for one id merge at commit (last wins), so the
 * two MUST resolve to the same material. Rather than keep a byte-identical
 * copy of material.ts + shaders/fragment.glsl here (they had already begun to
 * drift), this duplicate re-exports the grass region's material — the biome
 * folder still owns its component (biome.tsx), only the content is shared.
 */
export { getMaterial } from "../../../grass/biomes/grass/material";
