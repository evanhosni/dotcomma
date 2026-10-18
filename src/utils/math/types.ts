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
