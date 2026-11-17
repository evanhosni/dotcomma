export const FRAGMENT_CELL = 8;
export const FRAGMENT_MAX_CELLS = 78; // ≈ 5000u²
/** Land: a city vertex not painted as riverbed with a road field under a building's band, or an
 *  off-city freeway's painted corridor. */
export const FRAGMENT_LAND_FIELD = 23;
/** Past the sidewalk band (and the lamp band): the road gives way to the ground, like under a deck. */
export const FRAGMENT_REMOVED_FIELD = 13;
/** Only land this near a river (factor-1 units past its footprint) and, in a city, this near its
 *  belt is checked: a fragment is the river's doing, and a city's inner quays join its streets. */
export const FRAGMENT_RIVER_REACH = 80;
export const FRAGMENT_BELT_REACH = 60;
/** A deck's landed end this near a lattice point of a piece connects it. */
export const FRAGMENT_DECK_REACH = 16;

/** Fine enough that a sliver a few units wide holds lattice points. */
export const ISLAND_CELL = 6;
export const ISLAND_MAX_CELLS = 62; // ≈ 2250u² of curb, sidewalk and plaza
/** Block land starts at the curb strip. */
export const ISLAND_CURB_FIELD = 7;
/** A piece takes along the road's curb dip ramp around it, from its foot (cityCurbDip: roadWidth − 2):
 *  so the road where it stood is flat. Removed from the curb strip on, the ramp left a ring 0.3u high
 *  around it that the terrain's fake directional shading drew as a dark oval on the road. The ramp
 *  does not count toward ISLAND_MAX_CELLS (a long sliver's ramp outweighs it), and a piece of ramp
 *  alone is a road's, never removed. */
export const ISLAND_LAND_FIELD = 5;
export const ISLAND_PIECE_MAX = 4 * ISLAND_MAX_CELLS;
/** A piece goes to the bank when this many times more of its rim is bank than road. */
export const ISLAND_BANK_RIM = 2;
/** A building's band (building/spec.ts roadDistanceRange): a piece reaching it is a block. */
export const ISLAND_BUILD_FIELD = 23;
export const LATTICE_MAX = 200000;

/** Whether the straight line from (x, z) to (px, pz) stays on block land (islands.land), sampled
 *  every ISLAND_WALK_STEP, ends excluded. */
export const ISLAND_WALK_STEP = 1.5;

/** The road surface where an island going to road stood: the raw heights of the road around it (its
 *  field under ISLAND_LAND_FIELD, curb dip in full) ISLAND_FILL_RAYS ways, blended by inverse fourth-power
 *  distance — it meets the road at the piece's edge and runs smooth between. The island's own height
 *  was its block's plateau with the curb dip taken off: a bump of up to 0.6u, its edge a ring 0.3u
 *  high, that the terrain's fake directional shading drew as a dark oval on the road (screenshots). */
export const ISLAND_FILL_RAYS = 8;
export const ISLAND_FILL_STEP = 1.5;
export const ISLAND_FILL_REACH = 60;
