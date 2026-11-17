import { CITY_ARTERIAL_RECOVER_SLOPE } from "../constants";

export const CITY_DISTRICT_JITTER = 0.4;

// Arterials bend with two seeded sine octaves. District ASSIGNMENT follows the
// same curve so the rotated-grid switch always stays under the road surface.
export const CITY_WIGGLE_AMP = 38;
export const CITY_WIGGLE_K1 = (2 * Math.PI) / 620;
export const CITY_WIGGLE_K2 = (2 * Math.PI) / 260;

// circular block inside a roundabout ring road

// Roundabout ring-road centerline radius (× gridSize), centered on its 2×2
// super-cell: frac + roadWidth/gs must stay < 1.
export const CITY_RING_RADIUS_FRAC = 0.825;

// ── Remnants: cells the city's EDGE roads (belt, arterials, quays) leave too little of ──

/** Samples per axis across a cell; the middle CITY_CORE_SAMPLES² (centers ≥ a building's setback
 *  from the cell's border) are its CORE. */
export const CITY_CELL_SAMPLES = 9;
export const CITY_CORE_SAMPLES = 5;
/** The road field past the sidewalk band (LAND), and from the building filter's lower bound on
 *  (BUILDABLE: building/spec.ts roadDistanceRange). */
export const CITY_LAND_FIELD = 12;
export const CITY_BUILD_FIELD = 23;
/** A cell with fewer buildable core samples than this is a REMNANT. */
export const CITY_REMNANT_MIN_CORE = 8;
/** The label of a remnant no full block borders: remnants side by side then merge into one block. */
export const CITY_REMNANT_LABEL = 999;

/** W, E, S, N — the order of CellSurvey.sides. */
export const NEIGHBOR_STEPS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** A belt wall counts as DROWNED (the river's footprint reaches over it) across this window centered
 *  where its river-side curb is just dry (bank + freewayWidth), fading in over it (real units). Over 30u
 *  past that line, where a wall leaves the river at an angle its share rose 0.17 in 5u, and the belt's
 *  push past CITY_WATERFRONT_BELT_HOLD tore its outer edge into spikes of curb and sand (screenshot 97);
 *  over 60u past it, dry walls beside a river mouth gave their belt way to a block's tip (103). */
export const CITY_WATERFRONT_FADE = 60;
/** How far from a road's centerline its distance still matters to the city (real units): the
 *  belt's field has recovered well past the block band, and its paint and grade are long gone. */
export const CITY_WATERFRONT_READ = 80;
/** A wall is drowned only as far as it runs along the river: |cos| of the angle between them. */
export const CITY_WATERFRONT_ALIGN_LO = Math.cos((50 * Math.PI) / 180);
export const CITY_WATERFRONT_ALIGN_HI = Math.cos((30 * Math.PI) / 180);
/** A drowned wall's belt is pushed this far off (and the waterfront, where no wall is drowned), so the
 *  two hand the road over continuously: min() of the two, rounded by CITY_WATERFRONT_FILLET. The
 *  push grows over CITY_WATERFRONT_FADE — a steeper one aliases into a staircase curb. */
export const CITY_WATERFRONT_PENALTY = 45;
/** Where the river drowns a wall partly (its share 0 → 1), the belt stays on it up to
 *  CITY_WATERFRONT_BELT_HOLD, while the waterfront line's push eases off by smoothstep of the share, so
 *  the two overlap there and one road runs on from the other. Pushed away together, linearly (the belt
 *  by the share, the line by the rest), both were ~22u off midway: the belt ended in a stub on the sand
 *  and the waterfront began apart from it, a sidewalk tongue between them (screenshot). With the line
 *  fully in play from a share of 0.4 on instead, a second branch of it ran beside the first where the
 *  river's quay field folds, and the ridge between drew as a row of curb teeth. */
export const CITY_WATERFRONT_BELT_HOLD = 0.6;
/** The smooth minimum's reach where the belt turns onto the waterfront: a rounded corner. */
export const CITY_WATERFRONT_FILLET = 30;
/** Off the city the waterfront line is pushed away by this many units per unit outside the wall: on
 *  the wall it is the city's, so the two halves meet, and it never runs on into the neighbor. */
export const CITY_WATERFRONT_OUTSIDE_PUSH = 3;
/** The waterfront line comes into play as a drowned wall's share (wf) grows past CITY_WATERFRONT_ONSET:
 *  below it the line is pushed up to CITY_WATERFRONT_ABSENT off, past any belt distance (real units). */
export const CITY_WATERFRONT_ONSET = 0.1;
export const CITY_WATERFRONT_ABSENT = 1e4;

/** wallDrownedAt along a wall, sampled at WALL_DROWNED_SAMPLES points per wall and river list and
 *  interpolated (asked per vertex for every wall beside a river it cost ~15 ms per LOD1 chunk). */
export const WALL_DROWNED_SAMPLES = 17;

// ── getCityTerrain, step by step (workers are single-threaded: the steps share module scratch) ──

// Plateau ramps extend this far past the road half-width (across the sidewalk) for gentle grades.
export const CITY_RAMP_SPAN = 4;

// The chamfer cut sits at dᵢ + dⱼ = roadWidth / scale (≈ 28.6u at 0.35);
// fragments pinched narrower than that become road entirely.
export const CITY_CHAMFER_SCALE = 0.35;

// A pair only chamfers when its toward-road directions differ (corner wedge or
// pinch: dot ≤ 0). A road event ACROSS the street points the same way (dot ≈ +1)
// and must not notch this block's edge; the penalty fades in over [LO, HI].
export const CITY_CHAMFER_DOT_LO = 0.6;
export const CITY_CHAMFER_DOT_HI = 0.85;
export const CITY_CHAMFER_DOT_PENALTY = 60;

// Real units from a freeway centerline over which plateaus ramp to full height: from the asphalt's
// edge, so a freeway is flat across its lanes (a ramp starting nearer the centerline slopes the lanes
// toward the blocks and creases the belt down its middle at the wall); the end must stay inside the
// building setback (~35u) so block interiors are flat.
export const CITY_FREEWAY_RAMP_START = 14;
export const CITY_FREEWAY_RAMP_END = 34;

/** The current vertex's road CONSTRAINTS: distance + toward-road unit direction in the WORLD frame
 *  (NaN = pairable with anything: the belt). */
export const MAX_ROAD_CONSTRAINTS = 24;
/** At the wall the city's road field is the belt's — what the neighbor side reads there — falling off
 *  at this many street units per real unit inside it: steeper than the belt's own field ever climbs
 *  (CITY_ARTERIAL_RECOVER_SLOPE), so it only acts where a drowned wall's belt moved onto the
 *  waterfront — a street running into such a wall dipped its curb against a neighbor with no road at
 *  all (0.3u). Elsewhere the belt's field IS the nearest constraint at the wall. */
export const CITY_WALL_FIELD_FALLOFF = CITY_ARTERIAL_RECOVER_SLOPE + 1;

/** Within freewayWidth + this of a SECOND freeway (an arterial side or the belt), the lane paint stops. */
export const CITY_JUNCTION_CLEAR = 10;
