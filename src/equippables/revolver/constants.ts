/** The revolver placeholder's dimensions (u, a beeble is ~2u tall): geometry.ts. */
export const BORE_Y = 0.045;
export const BARREL_LENGTH = 0.16;
export const BARREL_RADIUS = 0.011;
export const DRUM_RADIUS = 0.027;
export const DRUM_LENGTH = 0.05;
export const GRIP_LENGTH = 0.085;
/** Where a bullet leaves it, in its own space (the end of the barrel). */
export const MUZZLE: readonly [number, number, number] = [0, BORE_Y, 0.02 + DRUM_LENGTH / 2 + BARREL_LENGTH];
