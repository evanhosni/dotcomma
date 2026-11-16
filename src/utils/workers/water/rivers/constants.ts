/** The river system's fixed numbers (water/DECISIONS.md holds the why behind each). Three-free. */

import { domainConfig } from "../../computeConfig";

/** The river grid: its own voronoi partition, shifted so it never lines up with the region grid.
 *  FROZEN with the seed strings in network.ts: changing either moves every river. */
export const RIVER_GRID_SIZE = 2800;
export const RIVER_GRID_SHIFT_X = 1237;
export const RIVER_GRID_SHIFT_Z = 811;
/** A river cell's Delaunay window reaches this many cells each way: every triangle whose circumcircle
 *  stays inside it is a true one, and every edge crossing the cell has both of its triangles so. */
export const RIVER_WINDOW_CELLS = 4;
/** Pieces are at most this long. */
export const RIVER_PIECE_LENGTH = 50;

/** Width factor per junction: ±RIVER_WIDTH_JITTER (× its <Rivers width> and the lakes' widening, ../joins
 *  riverWideningAt), capped at RIVER_WIDTH_MAX. */
export const RIVER_WIDTH_JITTER = 0.25;
export const RIVER_WIDTH_MAX = 2.4;
/** End shapes (network.ts EndKind): a POND end or a MOUTH widens to RIVER_POND_FACTOR over its last
 *  RIVER_POND_LENGTH — drawn so only where its pond's disc (rivers/ponds.ts) may not stand (a lake, a road
 *  in reach), or at a mouth, since the road layer and the decks read the river's pieces alone; every other
 *  end keeps the river's width. */
export const RIVER_POND_FACTOR = 1.7;
export const RIVER_POND_LENGTH = 100;
/** No footprint is ever wider than this (two pond ends on one short stretch multiply; a disc is capped to it). */
export const RIVER_SHAPED_MAX = RIVER_WIDTH_MAX * RIVER_POND_FACTOR;
/** A pond disc is never wider than a river joint (riverMaxReach and the field tile pad hold for both). */
export const DISC_WIDTH_MAX = RIVER_SHAPED_MAX;

/** A river's MID-RIVER pond opportunities (rivers/ponds.ts): one slot every this far along an edge, rolled
 *  before any kind is known — the opportunity grid, as the standalone cell is; a <Pond midRiver> chance is
 *  the lever. */
export const POND_MID_RIVER_SPACING = 400;
/** A SUMMIT pond (rivers/summits.ts) stands on its gap's flattest joint within this of the gap's top
 *  (real units): the search's tolerance, not a look. */
export const SUMMIT_SLIDE_DROP = 25;

/** Piece codes: built, or the reason it is not. */
export const PIECE_BUILT = 0;
export const PIECE_WATER = 1;
export const PIECE_HIGH = 2;
export const PIECE_MOUNTAIN = 3;
export const PIECE_ROAD = 4;
export const PIECE_GORGE = 5;
/** In a DRY biome (`<Rivers chance={0}>`): final — never gap-filled, gorged or built by any later layer. */
export const PIECE_DRY = 6;
/** On a summit connection's climb (rivers/summits.ts): built, its water falling away from the summit pond. */
export const PIECE_CLIMB = 7;
export const pieceBuilt = (code: number): boolean => code === PIECE_BUILT || code === PIECE_GORGE || code === PIECE_CLIMB;

/** A river's pieces this far into a lake are deep WATER and not built, whichever way the edge is walked:
 *  under the lake they would only be drawn below its water, and the mouth's run-on into the basin is the
 *  rest. Network-internal (the edge's own layer, frozen with the map): no prop. */
export const RIVER_MOUTH_REACH = 160;
/** Biome relief over this (on the network's approximate terrain) is a MOUNTAIN no river is built on.
 *  Coupled to the mountain's <Noise offset> through the proxy's fade (world/water/README.md "Known
 *  couplings"): no prop. The rest of the gap rules are <Rivers> props (params.ts GapRules). */
export const RIVER_MAX_RELIEF = 40;
/** The gorge rise is sampled this often along the gap. */
export const RIVER_GORGE_SAMPLE = 25;

/** Under a freeway the surface stands this far under the lower landing, sampled this far past the
 *  footprint along the road, and the cap rises at most RIVER_CAP_GRADE per unit along the river. */
export const RIVER_ROAD_CLEARANCE = 5;
export const RIVER_LANDING_PAST = 12;
export const RIVER_CAP_GRADE = 0.12;

/** The road layer: a road within RIVER_ROAD_ALIGN of the river inside its footprint for
 *  RIVER_ROAD_ALONG_MIN or more takes the river's place. */
export const RIVER_ROAD_ALIGN = (35 * Math.PI) / 180;
export const RIVER_ROAD_ALONG_MIN = 500;
/** Kept beside a deckable stretch within this; a belt within RIVER_BELT_CARRIED of the river is the
 *  waterfront's; an open end tees into a decked road within RIVER_TEE_REACH. */
export const RIVER_DECKABLE_NEAR = 20;
export const RIVER_BELT_CARRIED = (40 * Math.PI) / 180;
export const RIVER_TEE_REACH = 24;
/** An end at a junction every other river gave up retracts at most this many pieces. */
export const RIVER_JUNCTION_RETRACT = 2;

/** The distance is measured from a query point wiggled by up to RIVER_MEANDER_AMP on a
 *  RIVER_MEANDER_SCALE period, so straight edges wind a little. */
export const RIVER_MEANDER_AMP = 10;
export const RIVER_MEANDER_SCALE = 90;
/** Different rivers meet with a fillet this wide (factor-1 units). */
export const RIVER_FILLET = 24;
/** The flow fades across a piece joint over this (real units each way). */
export const RIVER_FLOW_BLEND = 10;

/** Nothing is placed within this of a river centerline (factor-1 units): channel and banks. */
export const riverKeepOff = (): number => domainConfig!.river.halfWidth + domainConfig!.river.bank;
/** The farthest a footprint reaches from its centerline (real units). */
export const riverMaxReach = (): number => riverKeepOff() * RIVER_SHAPED_MAX + RIVER_MEANDER_AMP;
/** The farthest from a piece's centerline (real units) a point can read inside a footprint: the
 *  fillet pulls the distance in by at most a quarter of its width. */
export const riverWetReach = (): number => (riverKeepOff() + RIVER_FILLET / 4) * RIVER_SHAPED_MAX + 2 * RIVER_MEANDER_AMP;
