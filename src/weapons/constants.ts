/** First person: the gun in front of the eye, right and down (camera space, u), and how far it kicks back
 *  and up at a shot, settling at RECOIL_SETTLE per second. */
export const VIEW_OFFSET: readonly [number, number, number] = [0.16, -0.15, -0.36];
export const VIEW_SCALE = 1;
export const RECOIL_BACK = 0.06;
export const RECOIL_PITCH = 0.35;
export const RECOIL_SETTLE = 9;

/** The muzzle flash: how long it shows (s) and how big (u), and the name of the sprite a weapon's model
 *  carries for it. */
export const FLASH_SECONDS = 0.06;
export const FLASH_SIZE = 0.16;
export const MUZZLE_FLASH_NAME = "muzzle-flash";
/** A bullet hole's width (u). */
export const BULLET_HOLE_SIZE = 0.13;

/** A bullet goes through a body this deep (u), leaving a hole at each surface it crosses. */
export const MAX_BODY_DEPTH = 1.5;
/** A body is tested only when the shot passes within this of its origin (u: a beeble's reach). */
export const BODY_TEST_RADIUS = 2.5;
/** An exit hole is wider than its entry. */
export const EXIT_WOUND_SCALE = 1.3;
