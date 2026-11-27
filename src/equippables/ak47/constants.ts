/** The AK-47 placeholder's dimensions (u, a beeble is ~2u tall): geometry.ts. Its origin is the pistol grip. */
export const BORE_Y = 0.06;
export const RECEIVER_LENGTH = 0.34;
export const BARREL_LENGTH = 0.3;
export const BARREL_RADIUS = 0.011;
/** The receiver's front, where the barrel starts. */
export const RECEIVER_FRONT = 0.22;
/** Where a bullet leaves it, in its own space (the end of the barrel). */
export const MUZZLE: readonly [number, number, number] = [0, BORE_Y, RECEIVER_FRONT + BARREL_LENGTH];
