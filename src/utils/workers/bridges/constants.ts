/** The bridge enumerator's shared dimensions and rule thresholds (each module keeps its own). Leaf
 *  module: imports nothing from the pipeline but the live config, so any top-level value may read it. */

import { domainConfig } from "../computeConfig";
import type { BridgePlacementParams } from "./types";

/** Deck half-width past the freeway half-width (bridgeSpec's BRIDGE_DECK_WIDTH = 2·(fw + margin))
 *  and the lateral feather of the under-deck bank cut (computeVertexData). */
export const BRIDGE_DECK_MARGIN = 1.5;
export const BRIDGE_CUT_FEATHER = 4;
/** An inter-city run yields to a river (the terrain pushes its paint to sand, a deck carries it) only
 *  this far into the river's field (factor-1 units): the water band and a few units more. The belt
 *  and the city's roads yield across the whole footprint (halfWidth + bank), like the quay. */
export const runRiverYield = (): number => domainConfig!.river.halfWidth + domainConfig!.river.bank * 0.5 + 6;

/** Under a deck the terrain is cut to this far below the deck's TOP (computeVertexData): the ground
 *  never rises through it, and at a landed end — where the deck lies on the road — the step under
 *  the slab's end stays invisible. */
export const BRIDGE_CUT_BELOW_TOP = 0.08;

/** THE placement every deck is built with (bridgeSpec's BRIDGE_PLACEMENT re-exports it). */
export const DEFAULT_BRIDGE_PLACEMENT: BridgePlacementParams = {
  abutment: 3,
  archChance: 0.5,
  maxCamber: 5,
  pierSpacing: 16,
  pierLateral: 9,
};

/** Everything a chain reaches outside itself — a wet stretch merging on, an end meeting another, a
 *  tee — lies within this of it: a chain with a sample this close to its window's edge may differ
 *  from what a wider window sees (freewayBridges.ts' BRIDGE_WINDOWS). */
export const BRIDGE_EDGE_GUARD = 48;
/** Longer chains drop deterministically, whatever the window: so an owned chain never reaches the
 *  first window's guard (a midpoint ≤ 181 from the center, + L/2, + the warp's 150u spread between
 *  two points, + the guard ≤ 900), and a T closure two chains deep fits the last. */
export const BRIDGE_MAX_LENGTH = 1000;
/** Road paths are sampled this often (and a deck's own lattices follow it). */
export const BRIDGE_WET_SAMPLE = 8;
/** Wet stretches of one road closer than this merge into one deck. */
export const BRIDGE_WET_MERGE = 16;
/** Road legs within a footprint + this are sampled: far enough that every path end is dry. */
export const BRIDGE_ROAD_MARGIN = 60;

/** The deck bends only where the road does: Douglas–Peucker over the unwarped samples. Tight, so
 *  its edges stay on the road's curbs and its ends square to the road it lands on (at 5u decks lie
 *  askew over the road at their ends). */
export const BRIDGE_MAX_DEVIATION = 1.5;

/** A T trim is (W/2)/sin θ; shallower than this angle it is clamped (a near-parallel T). */
export const BRIDGE_MIN_T_SIN = 0.25;

/** A deck landed at both ends must CROSS a river bank to bank, at no shallower than this to the
 *  river: roads running along the shore (a belt around a city lobe at a river mouth) or grazing a
 *  river at a slant would make decks along the shore, V meets and wedges. In a city such a road
 *  simply ends at the quay, which runs along the bank. */
export const BRIDGE_MIN_CROSSING = (40 * Math.PI) / 180;
/** A deck may follow the river (within BRIDGE_ALONG_ALIGN of its direction, inside its footprint)
 *  for at most this long; a straight crossing at BRIDGE_MIN_CROSSING or steeper does not at all. */
export const BRIDGE_ALONG_ALIGN = (35 * Math.PI) / 180;
export const BRIDGE_MAX_ALONG_SHORE = 60;
/** A deck turns at most this much within BRIDGE_TURN_WINDOW: a road rounding a corner over the water
 *  (a belt at a city lobe's tip) would make a V-kinked deck. */
export const BRIDGE_MAX_TURN = (45 * Math.PI) / 180;

/** A T end farther than this from its host's centerline is not on the host. */
export const BRIDGE_TEE_OFF_HOST = 2;

/** The last this many units of a LANDED end (at most BRIDGE_RAMP_SHARE of the deck) ramp into the
 *  road, so the slab's end is no ledge over the asphalt wherever the road falls away across the
 *  deck's width or ahead of it; long enough to climb the deck's BRIDGE_DECK_LIFT gently. */
export const BRIDGE_RAMP_LENGTH = 20;
export const BRIDGE_RAMP_SHARE = 0.3;

/** Every landed end's deck line stands this far over the road it lands on (the ramp brings the
 *  slab down into the road): the ground under a deck sits at least this far under its top, so the
 *  ground's texture never shows through it. */
export const BRIDGE_DECK_LIFT = 1;
/** A landed end cut along the road's edge (landedCut) stands this far under the road there: flush,
 *  without the terrain and the slab fighting over the same surface. */
export const BRIDGE_CUT_FLUSH = 0.05;

/** The deck's full width: the 4-lane freeway plus BRIDGE_DECK_MARGIN each side. */
export const deckWidth = (): number => 2 * (domainConfig!.cityConfig.freewayWidth + BRIDGE_DECK_MARGIN);
export const BRIDGE_PARAPET_WIDTH = 0.6;

/** A street-width deck (a crossing of its own landing on the quays): a street plus the margin. */
export const streetDeckWidth = (): number => 2 * (domainConfig!.cityConfig.roadWidth + BRIDGE_DECK_MARGIN);

/** Sample spacing of curved mouth decks and of the crossing counts along a deck (world units). */
export const MOUTH_SAMPLE = 4;
