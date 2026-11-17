import { OPENING_RADIUS_MAX } from "../underground/constants";
import { MOUTH_ROCK_REACH_RADII } from "../underground/caves/constants";

export const ROCK_SHAPE_COUNT = 8;

/** A rock's half sizes along its own axes, as shares of its size: the width axes and the height. */
export const WIDTH_SHARE_MIN = 0.8;
export const WIDTH_SHARE_MAX = 1.3;
export const HEIGHT_SHARE_MIN = 0.5;
export const HEIGHT_SHARE_MAX = 1.0;
/** The tilt about the rock's own z, radians. */
export const PITCH_MAX = 0.35;
/** The share of its height a rock sinks under its lowest drawn ground. */
export const BURY_MIN = 0.2;
export const BURY_MAX = 0.5;
/** A mouth's rock cannot stand where the ground rises more than this many heights across it (the hood's face). */
export const MOUTH_ROCK_RISE_HEIGHTS = 2;
/** A mouth's rocks reach this far from its opening point: the scatter reach of the widest opening, doubled, plus a pad. */
export const MOUTH_ROCK_REACH = MOUTH_ROCK_REACH_RADII * OPENING_RADIUS_MAX * 2 + 20;
/** Mouths are fetched this far beyond their reach (a mouth's section runs into the mountain). */
export const MOUTH_FETCH_PAD = 100;
