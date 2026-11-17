

/** The road grade takes over the terrain this far past the freeway's half-width (real units). */
export const FREEWAY_GRADE_RAMP = 10;

export const GRADE_STEP = 8;
export const GRADE_TAPS = [-2, -1, 0, 1, 2];
export const GRADE_TAP_WEIGHTS = [1, 2, 3, 2, 1];

/** A run never climbs or falls steeper than this (rise per unit of world arc): tan 45°. Where the ground
 *  along it is steeper, the road cuts into it. */
export const FREEWAY_MAX_GRADE = 1;
/** The profile at a point weighs the ground this far along the run each way (world units): a dip deeper
 *  than this under a point that far off is the only thing it can miss. */
export const PROFILE_REACH = 320;
/** A wet stretch (a river's footprint, where a deck carries the road) is bridged by the ground on either
 *  side of it, looked for this many lattice points out. */
export const WET_BRIDGE_POINTS = 48;
/** A leg past an end it shares with another leg gives way to that leg over this far (warped units). */
export const SHARED_END_FADE = 8;

/** Within freewayWidth + this of BOTH a run and a city wall, the two roads are merging: no lane paint. */
export const FREEWAY_MERGE_CLEAR = 12;
/** A deck landing's approach lays its road flat this far past the freeway's half-width (real units,
 *  warped like every road distance) before its shoulder: past the deck's sides (BRIDGE_DECK_MARGIN)
 *  wherever the road warp stretches them out to ~1.4× (a ramp end measured 21 at the deck's side). */
export const APPROACH_WIDEN = 8;
/** …and its shoulder meets the ground over this, gentler than a road's own FREEWAY_GRADE_RAMP: a landing's
 *  approach often stands units over a bank the river carved, and at 10u that edge measured 2–7u kinks. */
export const APPROACH_SHOULDER = 30;
/** How far from a freeway centerline the normalized road distance is still written (real units). */
export const FREEWAY_FIELD_REACH = 70;
/** How far past a river's footprint (real units) a vertex can still read a city wall the river drowns:
 *  the belt's field reach, plus the freeway's half-width (14) and the waterfront's fade (30, cityTerrain)
 *  a drowned wall lies within, and a margin for the meander. */
export const BELT_DROWN_READ = FREEWAY_FIELD_REACH + 64;
/** A road's field is pushed off the pavement over the last this many (factor-1) units of the zone
 *  it yields to a river in: continuous, so the road ends in a clean curbed line under the deck. */
export const ROAD_RIVER_RAMP = 16;
/** Past the river's footprint by this much (factor-1 units) the belt's straight river distance is
 *  still worth asking for: the meander moves the footprint's edge by at most RIVER_MEANDER_AMP. */
export const BELT_STRAIGHT_REACH = 30;
/** A road's field meets the river's push (step 5) over about this much (street units): a LOD1
 *  vertex spacing of the freeway's field (4.375u × roadWidth / freewayWidth ≈ 2.2), and a margin. */
export const ROAD_PUSH_SMOOTH = 5;
/** The river's push on a road's field grows no further than this (street units): far past the pavement. */
export const ROAD_PUSH_CAP = 40;

/** Over this far off the wall (real units) the belt's field beside a river hands over from the city's
 *  own rule to a smooth maximum that never paints the quay's bands out into the neighbor. */
export const BELT_FIELD_HANDOFF = 6;
