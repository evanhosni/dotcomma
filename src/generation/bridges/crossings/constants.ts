import { BRIDGE_EDGE_GUARD } from "../constants";

/** The rules keep decks off the shore, which alone leaves long stretches of river through a city
 *  with no deck at all: an arterial crossing at a slant, along a bank or into a T onto a dropped host has no deck, and neither do
 *  the city's streets. So a river with city on both banks gets CROSSINGS OF ITS OWN: where an
 *  arterial crosses it without a deck, and at least one per FILL_STEP along it. Each is STRAIGHT,
 *  at most CROSSING_MAX_SKEW off square to the river, and lands on pavement on both banks — the quay
 *  road counts — so it can never follow a shore, kink, V or end in the water. A fill crossing snaps
 *  onto one of its district's street lines, preferring one whose street goes on past both quays,
 *  and is a street-width deck. */
export const CROSSING_MAX_SKEW = (35 * Math.PI) / 180;
/** An arterial crossing its river shallower than this makes no crossing of its own (a fill one serves). */
export const CROSSING_MIN_ROAD_ANGLE = (20 * Math.PI) / 180;

/** One fill crossing per this much of a city river's stretch (at least one per stretch), none
 *  within FILL_CLEAR of another deck; each snaps at most FILL_SNAP_MAX along the river. */
export const FILL_STEP = 350;
export const FILL_CLEAR = 180;
export const FILL_SNAP_MAX = 80;
/** Two decks closer than their half-widths + this overlap: the later one gives way. */
export const CROSSING_OVERLAP_CLEAR = 4;
/** Crossings within the verdict's reach + this are tested for overlap (the snaps move both). */
export const CROSSING_NEAR_PAD = 60;
export const CROSSING_MARCH = 6;
export const CROSSING_SETTLE_STEP = 1.5;
/** A landing's end corners may stand this far past the curb (street units): on the sidewalk band. */
export const CROSSING_CORNER_SLACK = 4;
/** The farthest a crossing's landing may lie from the river centerline. */
export const CROSSING_MAX_HALF = 450;
/** A crossing's deck midpoint lies within this of its crossing point (the snap, and the two
 *  landings' different distances). */
export const CROSSING_MID_REACH = FILL_SNAP_MAX + CROSSING_MAX_HALF / 2;
/** A crossing's verdict reads the crossings within this (warped) — its window keeps it that far
 *  inside its edge, or the chain counts as at the edge. */
export const CROSSING_EDGE = FILL_CLEAR + 2 * FILL_SNAP_MAX + CROSSING_NEAR_PAD + BRIDGE_EDGE_GUARD;
