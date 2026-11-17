export interface PathSample {
  x: number;
  z: number;
  /** Arc length from the path's start. */
  u: number;
  floor: number;
  radius: number;
  /** Wall lumps (a fraction of the radius) and floor bumps (u). */
  bulge: number;
  bump: number;
}
