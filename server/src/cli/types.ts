export interface SlopeSample {
  x: number;
  z: number;
  height: number;
  /** From horizontal, radians. */
  angle: number;
  /** Unit horizontal direction pointing UPHILL. */
  ux: number;
  uz: number;
}

export interface SlopeSpotOptions {
  minDeg: number;
  maxDeg: number;
  radius?: number;
  /** The whole 3×3 neighborhood in range too — capsule-solid, not a one-triangle sliver. */
  solid?: boolean;
  /** Skip road corridors: a freeway grade's ramp edge is a steep but only ~1u-tall cut, not a
   *  natural slope (a steep scan landed on one once the rivers moved the grass patch). */
  offRoad?: boolean;
}
