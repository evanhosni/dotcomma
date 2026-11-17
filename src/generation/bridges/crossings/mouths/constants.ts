/** Two mouths at most this far apart are joined: a wide river crossed diagonally between two cities
 *  (at 300 every such case is left unconnected). */
export const MOUTH_PAIR_MAX = 700;
/** A curved deck leaves each road at most this far off the chord between the two mouths. */
export const MOUTH_PAIR_TURN = (50 * Math.PI) / 180;
/** The chord between two joined mouths is at most this far off square to the river (the curve itself
 *  must still cross at ≥ BRIDGE_MIN_CROSSING). */
export const MOUTH_PAIR_SKEW = (50 * Math.PI) / 180;
/** The Hermite's tangent length, × the chord. */
export const MOUTH_TANGENT = 0.6;

/** A branch meets its trunk at one of these angles, at stations this far apart along the trunk. */
export const MOUTH_BRANCH_ANGLES = [40, 55, 70].map((a) => (a * Math.PI) / 180);
export const MOUTH_BRANCH_STEP = 12;
/** Away from the junction a branch's slab keeps this clear of its trunk's. */
export const MOUTH_BRANCH_CLEAR = 2;

export const MOUTH_SINGLE_SKEW = (50 * Math.PI) / 180;
export const MOUTH_SINGLE_LAND = 24;
export const MOUTH_SINGLE_NUDGES = [0, 8, -8, 16, -16];

/** A run ending at a belt corner every belt from which enters the river within this is STRANDED. */
export const STRANDED_REACH = 40;

/** Mouths this close on one bank are one road junction: a deck landing at one serves them all
 *  (two decks from one junction would read as twins side by side). */
export const MOUTH_CLUSTER = 45;
