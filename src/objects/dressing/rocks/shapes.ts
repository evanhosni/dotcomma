/** The rocks' low-poly lumps: icosahedra with every corner pushed in or out and slid sideways, one of
 *  ROCK_SHAPE_COUNT per rock. Three-free: the client bakes them into its chunk meshes and the server
 *  builds the same trimesh colliders from them. */

import { seededStream } from "../../../utils/math/seededStream";
import { ROCK_SHAPE_COUNT } from "../../../utils/workers/vertexCompute";

export interface RockShape {
  /** Unit-radius corners (xyz triples). */
  positions: Float32Array;
  /** Twenty triangles, wound outward. */
  indices: Uint32Array;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICOSAHEDRON_CORNERS: [number, number, number][] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];
const ICOSAHEDRON_FACES: [number, number, number][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

const RADIUS_MIN = 0.72;
const RADIUS_MAX = 1.12;
const SLIDE = 0.11;

const makeShape = (variant: number): RockShape => {
  const s = seededStream(`rock-shape|${variant}`);
  const positions = new Float32Array(ICOSAHEDRON_CORNERS.length * 3);
  ICOSAHEDRON_CORNERS.forEach(([x, y, z], i) => {
    const len = Math.hypot(x, y, z);
    const r = s.between(RADIUS_MIN, RADIUS_MAX);
    // Slid sideways: a random direction in the corner's tangent plane.
    const ux = x / len;
    const uy = y / len;
    const uz = z / len;
    let tx = s.between(-1, 1);
    let ty = s.between(-1, 1);
    let tz = s.between(-1, 1);
    const d = tx * ux + ty * uy + tz * uz;
    tx -= ux * d;
    ty -= uy * d;
    tz -= uz * d;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const slide = s.between(-SLIDE, SLIDE);
    positions[i * 3] = ux * r + (tx / tl) * slide;
    positions[i * 3 + 1] = uy * r + (ty / tl) * slide;
    positions[i * 3 + 2] = uz * r + (tz / tl) * slide;
  });
  const indices = new Uint32Array(ICOSAHEDRON_FACES.length * 3);
  ICOSAHEDRON_FACES.forEach(([a, b, c], i) => {
    // Wound outward: flip a face whose normal points in after the corners moved.
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const outward = nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz) > 0;
    indices[i * 3] = a;
    indices[i * 3 + 1] = outward ? b : c;
    indices[i * 3 + 2] = outward ? c : b;
  });
  return { positions, indices };
};

export const ROCK_SHAPES: readonly RockShape[] = Array.from({ length: ROCK_SHAPE_COUNT }, (_, v) => makeShape(v));

/** A rock's lump in body-local space: its shape scaled per axis (the body carries yaw and pitch). */
export const rockLumpVertices = (variant: number, sx: number, sy: number, sz: number): Float32Array => {
  const shape = ROCK_SHAPES[variant];
  const out = new Float32Array(shape.positions.length);
  for (let i = 0; i < shape.positions.length; i += 3) {
    out[i] = shape.positions[i] * sx;
    out[i + 1] = shape.positions[i + 1] * sy;
    out[i + 2] = shape.positions[i + 2] * sz;
  }
  return out;
};
