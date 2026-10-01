/** Camera far plane, world units. The terrain LOD rings (world/terrain/lodConfig.ts) are sized
 *  against it — it must lie between the LOD4 and LOD5 rings, which lodConfig.ts asserts. */
export const CAMERA_FAR = 7200;
