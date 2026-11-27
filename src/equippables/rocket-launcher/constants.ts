/** The rocket launcher placeholder's dimensions (u, a beeble is ~2u tall): geometry.ts. Its origin is the
 *  front grip, the tube above it along +z. */
export const TUBE_Y = 0.12;
export const TUBE_RADIUS = 0.06;
export const TUBE_LENGTH = 1;
/** The tube's middle, ahead of the grip (it rests on the shoulder behind). */
export const TUBE_Z = 0.1;
/** Where the rocket leaves it, in its own space (the tube's mouth). */
export const MUZZLE: readonly [number, number, number] = [0, TUBE_Y, TUBE_Z + TUBE_LENGTH / 2 + 0.06];
/** The rocket in flight (u): its body, its warhead's length. */
export const ROCKET_RADIUS = 0.045;
export const ROCKET_LENGTH = 0.36;
export const WARHEAD_LENGTH = 0.14;
