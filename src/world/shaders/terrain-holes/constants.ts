export const MAX_TERRAIN_HOLES = 16;
export const MAX_TUNNEL_MASKS = 32;
/** A skirt pixel is hidden only this far (u) under its own ground: the LOD-border gap it exists for is
 *  above that, a tunnel's air (ROCK_COVER 4u under the ground) below it. */
export const SKIRT_MASK_COVER = 2;
/** A patch pixel whose rock share is under this is GROUND: only those give way to the terrain where the
 *  mouth's cut does not reach (world/shaders/biome-materials/index.ts); a wall pixel is never cut. */
export const PATCH_GROUND_SHARE = 0.05;
