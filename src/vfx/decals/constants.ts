/** Decals drawn by one instanced mesh, placed at its first decal: every decal's float32 offset from it stays
 *  small (COORDINATE_PRECISION.md), so a batch takes only decals within BATCH_REACH (u) of its origin. */
export const BATCH_SIZE = 256;
export const BATCH_REACH = 24;
/** A decal shrinks away over its last seconds. */
export const DECAL_SHRINK_SECONDS = 2;
/** Off its surface (u), against z-fighting; the material's polygon offset does the rest. */
export const DECAL_LIFT = 0.008;
