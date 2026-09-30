/** A point on the horizontal world plane. The world is y-up and `y` is height
 *  everywhere, so 2D code uses x/z — never THREE.Vector2 for a horizontal position. */
export interface PointXZ {
  x: number;
  z: number;
}
