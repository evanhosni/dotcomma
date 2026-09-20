/**
 * A point on the horizontal WORLD plane. The world is y-up: every 2D
 * algorithm here (voronoi, city grid, density placement, chunk offsets) works
 * on x/z, never x/y — `y` is height everywhere in this codebase. Worker-safe
 * (no THREE): use this instead of THREE.Vector2 for horizontal positions so a
 * reader never has to remember that ".y means z".
 */
export interface PointXZ {
  x: number;
  z: number;
}
