

/** Snow on a biome (`snow: true | {…}` on its spec): the snow line and the altitude band in GROUND HEIGHT
 *  (real units) and the pile depth's scale. Defaults: snow/snowParams.ts. */
export interface SnowParams {
  /** Below `lineLow` nothing lies; whole from `lineHigh` up. */
  lineLow: number;
  lineHigh: number;
  /** The altitude term (deeper, flatter-shouldered snow) is 0 at `altitudeLow`, 1 from `altitudeHigh`. */
  altitudeLow: number;
  altitudeHigh: number;
  /** Multiplies every pile depth (the 1.85u cap stays). */
  depthScale: number;
}

// ── The near sheet ─────────────────────────────────────────────────────────

export interface SnowDriftMesh {
  /** The chunk's center; positions are relative to it in x/z, absolute in y. */
  x: number;
  z: number;
  positions: Float32Array;
  normals: Float32Array;
  depths: Float32Array;
  indices: Uint32Array;
}

/** The sheet's nodes: the chunk's SNOW_GRID grid plus one node of margin on every side (the normals),
 *  each with its drawn ground, amount and depth; `any` is whether a node of the chunk itself has snow. */
export interface SheetNodes {
  /** Nodes per side, the margin included. */
  M: number;
  ground: Float64Array;
  amount: Float64Array;
  depth: Float64Array;
  any: boolean;
}
