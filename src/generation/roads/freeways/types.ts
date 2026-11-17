/** A run's grade lattice: every segment's canonical GRADE_STEP points in run order (a shared corner once),
 *  with its world arc, and the ground and profile there (NaN: not yet evaluated, or wet). */
export interface RunProfile {
  /** Index of each segment's first lattice point (its last is the next segment's first). */
  base: Int32Array;
  /** Lattice intervals per segment. */
  count: Int32Array;
  key: string[];
  /** Warped centerline point and the warped unit normal across the road. */
  px: Float64Array;
  pz: Float64Array;
  nx: Float64Array;
  nz: Float64Array;
  /** World arc from the run's start. */
  arc: Float64Array;
  ground: Float64Array;
  profile: Float64Array;
}
