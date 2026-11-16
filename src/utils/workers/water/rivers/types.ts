/** The river system's data model (rivers/network.ts: the design in one screen). Three-free. */

import type { PondMount } from "../ponds/params";
import type { GapRules } from "./params";
import type { RoadPath } from "../utils";

/** A JUNCTION of the river grid: a Delaunay triangle of three river sites, at its circumcenter. */
export interface RiverJunction {
  /** Its three site keys ("ix,iz"), sorted by (ix, iz), joined by "/". */
  key: string;
  x: number;
  z: number;
  /** The width factor every river meeting here has here. */
  width: number;
  /** In a water zone. */
  water: boolean;
}

/** A GORGE cut through a gap of an edge: joints k0 < k1 carry a straight water line between the waters at
 *  its ends; an end at a junction (`junctionEnd` 0 = k0 at junction a, 1 = k1 at junction b) takes the
 *  junction's water. */
export interface Gorge {
  k0: number;
  k1: number;
  junctionEnd: -1 | 0 | 1;
}

/** One voronoi edge of the river grid that carries a river, from junction a to b (warped space), cut
 *  into `count` equal pieces. Its layers (rivers/network.ts) are cached on it, each a pure function of
 *  the edge and its junctions' neighbourhoods; a piece's CODE (constants.ts PIECE_*) says it is built
 *  or why not. */
export interface RiverEdge {
  /** Its two site keys ("ix,iz"), string-sorted, joined by "~". */
  key: string;
  a: RiverJunction;
  b: RiverJunction;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  count: number;
  /** The rules it is judged by: its midpoint biome's <Rivers> (params.ts riversIn), as its chance is. */
  rules: GapRules;
  /** Dropped by its roll, kept to join two river ends (network.ts edgeOf). */
  revived?: boolean;
  /** The width factor at each of the count + 1 joints, end shapes included (once built: finalEdge). */
  widths?: Float64Array;
  /** Layer 1 (pieceRules.ts): its own codes, then with its gorges cut. */
  own?: Uint8Array;
  gorged?: Uint8Array;
  gorges?: Gorge[];
  /** Layer 2 (roadLayer.ts): whether roads can reach it, the roads it read (null: none near), the
   *  points (x, z pairs) a river end's water may not lie under, its codes before and after the ends
   *  retract. */
  nearRoads?: boolean;
  roads?: RoadPath[] | null;
  triggers?: number[];
  roadCodes?: Uint8Array;
  codes?: Uint8Array;
  /** Layer 1½ (summits.ts): its codes with its summit climbs built, and the climbs. */
  climbed?: Uint8Array;
  climbs?: Climb[];
  /** Layer 3 (network.ts): each piece as built, or null; the ponds at its stretches' ends (rivers/ponds.ts). */
  pieces?: (RiverPiece | null)[];
  ponds?: RiverPond[];
}

/** A POND a river holds (rivers/ponds.ts, summits.ts): its centre (warped), waterline radius (real), the
 *  <Pond> mount whose kind it is, the key its seeds hang from, and the joint of its edge its level is read
 *  from. */
export interface RiverPond {
  x: number;
  z: number;
  r: number;
  mount: PondMount;
  key: string;
  joint: number;
}

/** A SUMMIT connection: the pond on top (its level fixed by its ground) and the junction it climbs
 *  through, with the water the climb has when it gets there (null: the gap lies inside one edge). */
export interface Summit {
  pond: RiverPond & { level: number };
  /** The edge the pond's joint belongs to. */
  edge: RiverEdge;
  junction: RiverJunction | null;
  junctionWater: number;
}

/** A CLIMB on an edge: joints k0 < k1 on PIECE_CLIMB pieces (k0..k1 − 1) toward its summit's pond. */
interface Climb {
  k0: number;
  k1: number;
  summit: Summit;
}

/** A built piece of a river edge (warped space): its ends, the width factor at each, its edge and index. */
export interface RiverPiece {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  w0: number;
  w1: number;
  edge: RiverEdge;
  index: number;
}

