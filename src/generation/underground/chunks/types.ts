/** A finished triangle vertex: absolute position, normal, linear color, daylight. */
export interface Vertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  light: number;
}

/** A point daylight falls from (a mouth's axis point, a manhole's top): full within `near`, gone by `far`. */
export interface DaylightSource {
  x: number;
  y: number;
  z: number;
  near: number;
  far: number;
}
