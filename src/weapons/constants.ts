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

/** A blade cuts what its swing's plane crosses in front of the eye, within this angle of the look (cos). */
export const SWING_ARC_COS = Math.cos((75 * Math.PI) / 180);
/** First person: a swing sweeps the blade this far across (radians) over SWING_SECONDS. */
export const SWING_SWEEP = 2.2;
export const SWING_SECONDS = 0.22;
/** Each swing turns its plane off the horizontal by up to this (radians), alternating sides. */
export const SWING_TILT = 0.9;
/** A rocket flies this fast (u/s), and strikes a body passing within ROCKET_BODY_RADIUS of its origin. */
export const ROCKET_SPEED = 45;
export const ROCKET_BODY_RADIUS = 0.8;
/** An automatic's kick, as a share of a single shot's. */
export const AUTOMATIC_RECOIL = 0.4;