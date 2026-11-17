

/** A sequence of seeded rolls: ONE seedRand roll seeds an integer mulberry32, so every thread and the
 *  server draw the same numbers from the same string. A system draws its layout and its decoration from
 *  SEPARATE streams (`…|layout`, `…|decor`), so decoration never moves a passage. */
export interface SeededStream {
  /** [0, 1). */
  next(): number;
  between(min: number, max: number): number;
  /** −1 or +1 (a sign; `between(-a, a)` for a magnitude). */
  signedUnit(): number;
  /** Integer in [min, max]. */
  intBetween(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A Fisher–Yates shuffled copy. */
  shuffled<T>(items: readonly T[]): T[];
}

/** A point on the horizontal world plane. The world is y-up and `y` is height
 *  everywhere, so 2D code uses x/z — never THREE.Vector2 for a horizontal position. */
export interface PointXZ {
  x: number;
  z: number;
}

/** An axis-aligned rectangle on the horizontal plane (a chunk, a tile, a search area). */
export interface RectXZ {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
