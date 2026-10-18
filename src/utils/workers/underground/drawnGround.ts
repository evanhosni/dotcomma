/**
 * The ground AS LOD1 DRAWS IT: the terrain's 4.375u lattice (CHUNK_SIZE / LOD1_SEGMENTS), each cell
 * split along its (0,1)–(1,0) diagonal like the chunk geometry (world/terrain/chunkGeometry.ts), the
 * heights the worker's float32 buffers hold. Walls are cut against this surface, the entrance patch
 * stands on it, the manhole frames rest on it: measured against the exact ground the walls stopped
 * short of the drawn triangles wherever the two parted. Three-free; the lattice is a 2^18 cache that
 * clears with the tunnel caches.
 */

import { dropOldestHalf } from "../cellCache";
import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../world/terrain/lodConfig";
import { computeVertexData } from "../vertexCompute";

export const LATTICE = CHUNK_SIZE / LOD1_SEGMENTS;

const LATTICE_CACHE_MAX = 1 << 18;
const latticeHeights = new Map<number, number>();

/** A lattice point's cache key (the snow's cover lattice keys the same points): 2^26 cells per axis is
 *  ±290 million units. */
export const latticeKey = (m: number, n: number): number => m * 0x4000000 + n;

/** The float32 height the terrain worker uploads at lattice point (m, n). */
export const latticeHeightAt = (m: number, n: number): number => {
  const key = latticeKey(m, n);
  let h = latticeHeights.get(key);
  if (h === undefined) {
    if (latticeHeights.size >= LATTICE_CACHE_MAX) dropOldestHalf(latticeHeights);
    h = Math.fround(computeVertexData(m * LATTICE, n * LATTICE).height);
    latticeHeights.set(key, h);
  }
  return h;
};

export const clearDrawnGround = (): void => latticeHeights.clear();

/** The drawn ground's height at a world point: linear over the triangle of its lattice cell. */
export const drawnGroundAt = (x: number, z: number): number => {
  const fx = x / LATTICE;
  const fz = z / LATTICE;
  const m = Math.floor(fx);
  const n = Math.floor(fz);
  const u = fx - m;
  const v = fz - n;
  const h00 = latticeHeightAt(m, n);
  const h11 = latticeHeightAt(m + 1, n + 1);
  if (u + v <= 1) {
    const h10 = latticeHeightAt(m + 1, n);
    const h01 = latticeHeightAt(m, n + 1);
    return h00 + (h10 - h00) * u + (h01 - h00) * v;
  }
  const h10 = latticeHeightAt(m + 1, n);
  const h01 = latticeHeightAt(m, n + 1);
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
};

/** The lowest drawn ground over a square (every lattice point the square's cells touch). */
export const drawnGroundMinOver = (minX: number, minZ: number, maxX: number, maxZ: number): number => {
  const m0 = Math.floor(minX / LATTICE);
  const m1 = Math.floor(maxX / LATTICE) + 1;
  const n0 = Math.floor(minZ / LATTICE);
  const n1 = Math.floor(maxZ / LATTICE) + 1;
  let min = Infinity;
  for (let m = m0; m <= m1; m++) for (let n = n0; n <= n1; n++) min = Math.min(min, latticeHeightAt(m, n));
  return min;
};

const _normal = { x: 0, y: 1, z: 0 };
const _vertexNormal = new Float64Array(3);

/** A lattice vertex's normal as the terrain worker sums it: the six faces around it. Not normalized. */
const latticeVertexNormal = (m: number, n: number, out: Float64Array): void => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  // The two triangles of each of the four cells around the vertex, same winding as the chunk index buffer.
  const addFace = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    const ay = latticeHeightAt(ax, az);
    const by = latticeHeightAt(bx, bz);
    const cy = latticeHeightAt(cx, cz);
    const abx = (ax - bx) * LATTICE;
    const aby = ay - by;
    const abz = (az - bz) * LATTICE;
    const cbx = (cx - bx) * LATTICE;
    const cby = cy - by;
    const cbz = (cz - bz) * LATTICE;
    // cb × ab, as the worker's computeVertexNormals twin.
    nx += cby * abz - cbz * aby;
    ny += cbz * abx - cbx * abz;
    nz += cbx * aby - cby * abx;
  };
  for (let di = -1; di <= 0; di++) {
    for (let dj = -1; dj <= 0; dj++) {
      const i = m + di;
      const j = n + dj;
      // Triangle (a, d, b) = (i,j), (i,j+1), (i+1,j) and (d, c, b) = (i,j+1), (i+1,j+1), (i+1,j).
      const inFirst = (di === 0 && dj === 0) || (di === 0 && dj === -1) || (di === -1 && dj === 0);
      const inSecond = (di === 0 && dj === -1) || (di === -1 && dj === -1) || (di === -1 && dj === 0);
      if (inFirst) addFace(i, j, i, j + 1, i + 1, j);
      if (inSecond) addFace(i, j + 1, i + 1, j + 1, i + 1, j);
    }
  }
  // Summed in world axes with the worker's winding, so it already points up.
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  const len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
  if (len > 0) {
    out[0] /= len;
    out[1] /= len;
    out[2] /= len;
  }
  if (out[1] < 0) {
    out[0] = -out[0];
    out[1] = -out[1];
    out[2] = -out[2];
  }
};

const _n00 = new Float64Array(3);
const _n10 = new Float64Array(3);
const _n01 = new Float64Array(3);
const _n11 = new Float64Array(3);

/** The terrain's shading normal at a world point: the lattice vertices' unit normals interpolated
 *  over the triangle, as the GPU interpolates the varying. The result is shared: copy it. */
export const drawnNormalAt = (x: number, z: number): { x: number; y: number; z: number } => {
  const fx = x / LATTICE;
  const fz = z / LATTICE;
  const m = Math.floor(fx);
  const n = Math.floor(fz);
  const u = fx - m;
  const v = fz - n;
  let wa: number, wb: number, wc: number;
  let a: Float64Array, b: Float64Array, c: Float64Array;
  if (u + v <= 1) {
    latticeVertexNormal(m, n, _n00);
    latticeVertexNormal(m + 1, n, _n10);
    latticeVertexNormal(m, n + 1, _n01);
    a = _n00;
    b = _n10;
    c = _n01;
    wb = u;
    wc = v;
    wa = 1 - u - v;
  } else {
    latticeVertexNormal(m + 1, n + 1, _n11);
    latticeVertexNormal(m, n + 1, _n01);
    latticeVertexNormal(m + 1, n, _n10);
    a = _n11;
    b = _n01;
    c = _n10;
    wb = 1 - u;
    wc = 1 - v;
    wa = 1 - wb - wc;
  }
  _vertexNormal[0] = a[0] * wa + b[0] * wb + c[0] * wc;
  _vertexNormal[1] = a[1] * wa + b[1] * wb + c[1] * wc;
  _vertexNormal[2] = a[2] * wa + b[2] * wb + c[2] * wc;
  const len = Math.sqrt(_vertexNormal[0] ** 2 + _vertexNormal[1] ** 2 + _vertexNormal[2] ** 2) || 1;
  _normal.x = _vertexNormal[0] / len;
  _normal.y = _vertexNormal[1] / len;
  _normal.z = _vertexNormal[2] / len;
  return _normal;
};

/** The HIGHER of the drawn and the exact ground: what a thing resting on the street must clear. */
export const restingGroundAt = (x: number, z: number): number => Math.max(drawnGroundAt(x, z), computeVertexData(x, z).height);
