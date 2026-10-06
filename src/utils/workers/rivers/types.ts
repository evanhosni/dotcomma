/** The river network's shapes (riverNetwork.ts builds them, riverField.ts and the bridges read them). */

export interface RiverSegment {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  /** Width factors at the two ends (1 = the config's halfWidth/depth/bank), end shapes included. */
  w0: number;
  w1: number;
  /** The river-grid edge the piece belongs to and its index along it — its identity everywhere. */
  edge: string;
  index: number;
}

/** A river-grid edge that carries a river, cut into `count` equal pieces (warped space, oriented
 *  from the junction with the smaller key). Cached by key; every field is a pure function of the
 *  edge, so whichever window built it, it is the same edge. */
export interface RiverEdge {
  key: string;
  keyA: string;
  keyB: string;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  count: number;
  /** Junction width factors at A and B. */
  wA: number;
  wB: number;
  /** Per piece: 0 = built, else the RIVER_BLOCK_* reason. null until needed. */
  blocked: Uint8Array | null;
  /** `blocked` before the junction gaps are joined (the edge on its own). null until needed. */
  ownBlocked: Uint8Array | null;
  /** Per piece: 1 where its relief rule (RIVER_BLOCK_MOUNTAIN) is the mountain's ROCK (a domed
   *  biome), 0 where it is a tall but ordinary relief (dunes, hills). Set with ownBlocked. */
  rock: Uint8Array | null;
  /** The gorges built through its gaps (riverEdgeBlocked). */
  gorges: RiverGorge[];
  /** Width factor at each piece end (count + 1), end shapes included. null until emitted. */
  widths: Float64Array | null;
  /** Road layer, lazily per piece (-1 = not evaluated). */
  along: Int8Array;
  suppressed: Int8Array;
  /** The road layer's verdict per piece (riverEdgeRoadLayer), and before its end retraction; null until needed. */
  roadLayer: Uint8Array | null;
  roadUnretracted: Uint8Array | null;
  /** Whether the river ENDS at junction A / B (a pond or a fizzle: no built river continues). */
  endA: boolean;
  endB: boolean;
  /** -1 = not evaluated; 0 = no city within FREEWAY_LINK_CELLS of the edge (no road can reach it). */
  nearRoads: number;
}

/** A junction gap built as a gorge (riverEdgeBlocked): the edge's piece ends `from` (where its own
 *  river stops) through `to` (its junction end, 0 or count) carry a surface interpolated linearly from
 *  the water at (bx, bz) to the junction's — the river's surface at (jx, jz) where a river goes on
 *  through the junction, else the point `share` of the way along the joined pair's straight line from
 *  the water at (px, pz) to the water at (qx, qz), the same for every gorge of the junction
 *  (riverField's gorgeSurface). Warped. */
export interface RiverGorge {
  from: number;
  to: number;
  bx: number;
  bz: number;
  jx: number;
  jz: number;
  pair: boolean;
  px: number;
  pz: number;
  qx: number;
  qz: number;
  share: number;
}

/** A built piece in the shape the per-vertex field and the bridges consume; resolveRiverPiece
 *  applies the road layer (which only ever removes pieces). */
export interface RiverPiece {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  w0: number;
  w1: number;
  edge: RiverEdge;
  index: number;
  resolved: boolean;
  suppressed: boolean;
}
