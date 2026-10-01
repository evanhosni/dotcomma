/** The bridge enumerator's data: the public deck shape every consumer reads, and the intermediate
 *  records (road paths, wet items, chains, crossings, mouths) the enumerator builds per window. */

import type { PointXZ } from "../../math/types";
import { type RiverEdge, type RiverPiece } from "../rivers/riverNetwork";

export interface BridgePlacementParams {
  /** Deck extension onto the dry road past the footprint at each landed end (real units). */
  abutment: number;
  /** Chance a plain deck (no junction) is styled as an arch. */
  archChance: number;
  /** The styled arch's rise cap (and ≤ 6% of the length); clearance may raise it to BRIDGE_MAX_CAMBER. */
  maxCamber: number;
  /** Pier stations along the deck over the footprint; columns stand ±pierLateral from the centerline. */
  pierSpacing: number;
  pierLateral: number;
}

export interface FreewayBridgePier {
  x: number;
  z: number;
  /** RAW ground height under the station (no pad stands in a channel). */
  groundY: number;
  /** Arc fraction along the deck. */
  t: number;
  dirX: number;
  dirZ: number;
}

export interface BridgePathPoint {
  x: number;
  z: number;
  /** Arc fraction (world) along the deck, 0 at (sx,sz). */
  t: number;
}

/** A T-child's end section: the host's direction scaled so the child's full width W maps onto the
 *  host's slab edge (corner = end ± (W/2)·(x, z)), rising `slope` per unit of that offset — the
 *  host's grade — so the child is cut along the host's edge at the host's height. */
export interface BridgeTrimAxis {
  x: number;
  z: number;
  slope: number;
}

/** A stretch (arc fractions) where the parapet on `side` (+1 = left of travel) is OPEN: another
 *  deck's footprint covers it — a T-child's mouth, a deck overlapping this one. Exact: clipped
 *  against that deck's strip, so the wall stops at the other deck's edge whatever the angle. */
export interface BridgeParapetGap {
  side: 1 | -1;
  t0: number;
  t1: number;
}

/** A wall's run-on at a merge: `at` is a polyline of (outer, inner) corner pairs on the slab top (x, y, z
 *  each) from the wall's end to where it meets the other deck's wall; it stands `wall` × the parapet's
 *  height. */
export interface BridgeWallJoin {
  side: 1 | -1;
  wall: number;
  at: number[];
}

/** Lane paint along the deck, continuing the terrain road's: at each landed end whose road is
 *  painted (`has0`/`has1`) the dash phase there (`a`) and its rate per unit of world arc going
 *  OUTWARD onto the road (`r`); blended between the two ends. `off` (arc fractions): no paint —
 *  a junction, or a landed end whose road has none. */
export interface BridgeLanePaint {
  a0: number;
  r0: number;
  a1: number;
  r1: number;
  has0: boolean;
  has1: boolean;
  off: [number, number][];
}

/** A LANDED end's ramp into the road (bridgeRampAt): the end section lies `drop` below the deck's
 *  own end height, tilted `slope` per lateral unit (+ = left) to the road's cross-fall there, so the
 *  whole end section is under the road surface and the slab dives into it. */
export interface BridgeLanding {
  drop: number;
  slope: number;
  /** This end's ramp length: the standard one, or — where the deck lands obliquely and an edge lies
   *  over the road's pavement further in — long enough to bring the deck down onto the road over all
   *  of it, so traffic from any part of the road meets no wall and no ledge there. */
  ramp: number;
}

export interface FreewayBridge {
  /** Midpoint along the deck: the identity and the chunk-ownership key. */
  x: number;
  z: number;
  /** Deck-top heights at the path's two ends (the deck is sy→ey linear plus the camber arch). */
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  /** World-space centerline (the road's real curve within BRIDGE_MAX_DEVIATION). */
  path: BridgePathPoint[];
  length: number;
  /** Slab width (2 · (freewayWidth + BRIDGE_DECK_MARGIN)). */
  width: number;
  /** Arch rise at the middle of the drawn range [t0, t1] (bridgeTrimRange): y(t) += camber · 4u(1−u)
   *  with u = (t − t0)/(t1 − t0), so it is 0 at a T end. Only a plain deck carries the styled arch;
   *  a host, a merged chain, or a T-child whose landed end cannot step up far enough to clear the
   *  water carries the clearance arch. */
  camber: number;
  piers: FreewayBridgePier[];
  gaps?: BridgeParapetGap[];
  /** Wall ends at a merge, run on to the other deck's wall (wallJoins.ts). */
  wallJoins?: BridgeWallJoin[];
  paint: BridgeLanePaint;
  /** World arc trimmed off a T end (the child stops at the host's slab edge), and its end section. */
  trimStart?: number;
  trimEnd?: number;
  trimStartAxis?: BridgeTrimAxis;
  trimEndAxis?: BridgeTrimAxis;
  /** A street-width deck (a crossing of its own landing on the quays): its lateral offsets × this
   *  are the freeway-normalized ones the deck material's road bands read. */
  laneScale?: number;
  /** Per end (0 = the path start): the landed end's ramp, or null (a T end). */
  landings?: [BridgeLanding | null, BridgeLanding | null];
}

/** A road stretch near rivers: samples in path order, warped (wx, wz) and world (x, z). */
export interface RoadPath {
  kind: "run" | "belt" | "arterial" | "arterialSeg";
  wx: number[];
  wz: number[];
  x: number[];
  z: number[];
  /** A road cut where the city carries it along the bank (withoutCarriedStretches) at a dry sample:
   *  a wet stretch reaching that end is LANDED there, not open. */
  landed?: [boolean, boolean];
  /** Which ends are such cuts at all, landed or in the water. */
  carried?: [boolean, boolean];
}

/** A query window (warped). */
export interface BridgeWindow {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A maximal wet stretch of one road, with its ends. Polylines run from end 0 to end 1. */
export interface WetItem {
  index: number;
  kind: RoadPath["kind"];
  wx: number[];
  wz: number[];
  x: number[];
  z: number[];
  open: [boolean, boolean];
  /** A sample within BRIDGE_EDGE_GUARD of the window's edge: what lies beyond may change it. */
  edge: boolean;
  chain: BridgeChain | null;
}

/** An end of a chain: on the road (landed), onto another deck (tee: a road's wet item, or a mouth
 *  branch's trunk chain), or nowhere (the chain drops). */
export type ChainEnd = { kind: "landed" } | { kind: "tee"; host: WetItem | null; hostChain?: BridgeChain; hx: number; hz: number } | { kind: "open" };

export interface BridgeChain {
  parts: { item: WetItem; reversed: boolean }[];
  ends: [ChainEnd, ChainEnd];
  merged: boolean;
  /** T links onto this chain (children whose end tees into it). */
  children: BridgeChain[];
  /** World and warped polyline, unsimplified (samples). */
  x: number[];
  z: number[];
  wx: number[];
  wz: number[];
  path: PointXZ[];
  cum: number[];
  length: number;
  midX: number;
  midZ: number;
  /** World bounding box of the path. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  state: 0 | 1 | 2;
  deck: FreewayBridge | null;
  drop: string;
  edge: boolean;
  /** A crossing of its own (section 6): no road items, a straight deck from pavement to pavement. */
  synth?: Crossing;
  /** A mouth crossing's own verdict (mouthPre), memoized. */
  pre?: string;
  /** A natural branch finds its host and geometry in the window (deckBuilder's resolveNatural). */
  resolver?: () => boolean;
}

/** One cross-section of the deck: its centerline point and top height, and its lateral axis
 *  (+ = left; mitered between neighbors, the host's edge at a T end) with the top's rise per
 *  lateral unit along it (the host's grade at a T end, else 0). */
export interface BridgeSection {
  t: number;
  x: number;
  y: number;
  z: number;
  ax: number;
  az: number;
  slope: number;
  /** Fraction of the parapets' height standing here (bridgeRampAt). */
  wall: number;
  /** The slab's half-widths left (+) and right of the centerline, in axis units: W/2, and more where a
   *  T end's crotch is filleted (crotchFlares). */
  wl: number;
  wr: number;
}

/** One chunk's view: the window (warped) around its center and the river pieces that reach it. */
export interface WindowScan {
  win: BridgeWindow;
  /** Half the window's side. */
  size: number;
  /** The chunk center, world and warped. */
  cx: number;
  cz: number;
  center: PointXZ;
  /** The river footprint in factor-1 units (halfWidth + bank). */
  reach: number;
  /** Every raw piece whose wet field can reach into the window: they choose the roads to sample. */
  pieces: RiverPiece[];
  /** The built ones (the road layer applied), lazily. */
  built: RiverPiece[] | null;
}

/** A T end, resolved against its host deck. */
export interface TeeTrim {
  trim: number;
  /** Arc the end's oblique cut sweeps past the trim (bridgeTrimSweep). */
  sweep: number;
  axis: BridgeTrimAxis;
  /** The host deck of a T end; null for a landed end cut along the road's edge (landedCut). */
  host: FreewayBridge | null;
}

export interface Crossing {
  /** Identity: the river piece of a fill slot, the crossing point of an arterial, a freeway mouth
   *  (or the pair of mouths facing each other across the river). */
  key: string;
  kind: "arterial" | "fill" | "mouth";
  /** A mouth crossing's mouths: two (a curved deck from one to the other) or one (a straight deck). */
  mouths?: Mouth[];
  /** The point on the river centerline (world and warped), the river's unit direction (world). */
  x: number;
  z: number;
  wx: number;
  wz: number;
  rx: number;
  rz: number;
  /** The arterial's unit direction (world); 0 for a fill slot. */
  tx: number;
  tz: number;
  /** Higher wins between two crossings in each other's way. */
  prio: number;
  /** A mouth branch's trunk (its crossing key). */
  trunk?: string;
  /** A mouth crossing's geometry, found with its mouths (mouthsOf) — a natural branch's in the window. */
  geom?: CrossingGeom;
  /** A NATURAL branch: the mouths across the river whose road's own deck it may tee into, best first. */
  faces?: Mouth[];
  /** A mouth crossing's conservative world bounds (before its geometry is known). */
  box?: number[];
  /** The mouths a pair's or a branch's deck serves: its own and every mouth at the same road
   *  junction (within MOUTH_CLUSTER on the same bank). */
  covers?: Mouth[];
}

/** A crossing's straight deck: two landed ends, canonically ordered, with their road heights. A
 *  pure function of the crossing — every window computes the same, so it is cached across them. */
export interface CrossingGeom {
  ok: boolean;
  why: string;
  path: PointXZ[];
  ys: [number, number];
  /** Where it crosses the river centerline (a fill slot snaps onto a street line). */
  x: number;
  z: number;
  width: number;
  street: boolean;
  /** A mouth branch: which path end tees into its trunk (the other is landed). */
  teeEnd?: 0 | 1;
}

/** Every freeway a river separates is connected by a deck. A MOUTH is where any freeway
 *  — a city arterial, a belt, an inter-city run, in a city or not — is last dry across a deck's whole
 *  width before a river's footprint, past the abutment: where a freeway deck lands. Found per river
 *  edge over the whole edge, so every window agrees:
 *   - mouths facing each other across the river are PAIRED (best first, only where the curve keeps
 *     the rules) by a freeway-width deck, curved (a cubic Hermite tangent to both roads);
 *   - a mouth left over that faces a paired mouth BRANCHES onto that pair's deck (the trunk): a
 *     freeway-width deck teeing into it, on the far side of the centerline where it can, so the two
 *     merge into a Y before landing on the shared mouth;
 *   - a mouth facing none gets a STREET-width straight deck to the pavement across, if there is any
 *     (a freeway-width deck only where a freeway is on both sides).
 *  Every one crosses the river's centerline once at ≥ BRIDGE_MIN_CROSSING over one wet stretch, and
 *  none kinks or follows the shore (never near parallel to the river). A natural deck already serving a mouth (its road's own) makes it none. */
export interface Mouth {
  key: string;
  kind: RoadPath["kind"];
  x: number;
  z: number;
  /** Unit direction (world) into the river, along the road. */
  dx: number;
  dz: number;
  /** The bank: the sign of the mouth's side of the edge (warped). */
  side: number;
  /** Unit normal (world) of the river at the mouth, pointing across it. */
  nx: number;
  nz: number;
  /** Its wet stretch reaches this edge's CHANNEL: only then does a lone mouth get a deck. */
  channel: boolean;
  /** Where a straight deck from the mouth, turned toward square, crosses the centerline (world); null if none does. */
  hit: PointXZ | null;
  hitDx: number;
  hitDz: number;
  edge: RiverEdge;
}

/** A freeway connection the water severs: a wet stretch of a freeway (its centerline yields to the
 *  river, as the terrain has it) that nothing carries across. */
export interface SeveredFreeway {
  x: number;
  z: number;
  kind: RoadPath["kind"];
  /** Real length of the stretch's uncarried samples. */
  length: number;
  /** The stretch: crosses a river bank to bank ("cross"), grazes one and leaves on the bank it came
   *  from ("graze"), or the road ends in it at a junction across the river ("open"). */
  shape: "cross" | "graze" | "open";
  city: boolean;
}
