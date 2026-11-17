

/** The plaza band's start (the city shader's sidewalk ends at ROAD_HALF_WIDTH + 5). */
export const SIDE_POINT_MAX_FIELD = 12;

/** The lateral offset is solved so the lamp stands at the TARGET road-field distance: the road is
 *  measured from a meandered point (±3u), so a fixed offset from the polyline would wander on and off
 *  the curb. */
export const LATERAL_ITERATIONS = 4;
export const LATERAL_TOLERANCE = 0.75;
/** An offset that moved further than this from the nominal one found another road's verge. */
export const LATERAL_DRIFT_MAX = 6;
/** How far outside the chunk a first guess may land and still be solved into it. */
export const SOLVE_SLACK = LATERAL_DRIFT_MAX + 2;
/** A bridge deck's landed end carries the road this far past the river's footprint at most; the
 *  road centerline beside a lamp is checked for a deck this far along both ways. */
export const DECK_ALONG_CLEAR = 16;
/** Only within this many river footprints of a river can a deck stand nearby. */
export const DECK_RIVER_REACH = 3;
/** Slope stencil half-step (real units). */
export const SLOPE_STEP = 1.5;
/** A little over the drawn pole's half-width (lampSpec: 0.22): the base sinks by the slope across it. */
export const POLE_SINK_RADIUS = 0.15;
