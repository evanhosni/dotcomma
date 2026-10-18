/**
 * Surface nets over a field at VOXEL spacing, one BRICK at a time, crack-free across bricks and
 * chunks: a cell's vertex is keyed by its lattice cell and shared through `NetVertices`, and each
 * brick owns the lattice edges starting on its lower faces, so every edge of the world belongs to
 * exactly one brick and every vertex is computed once from the same field. Three-free.
 */

import { BRICK, VOXEL } from "./constants";
import type { FieldFn } from "./tunnelField";

/** What a settled sample reads: positive, and never interpolated (see meshBrick). */
const ROCK_STAND_IN = 1;
/** The vertex normal's central difference, in voxels. */
const NORMAL_EPS = 0.5;
/** Samples settled by the sound bound come in blocks of this many voxels (DECISIONS.md: 4 measured best). */
const BLOCK = 4;

export interface NetsOutput {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** Cell → vertex index, shared by every brick of one mesh. Keys are numbers relative to the mesh's
 *  base cell (a string per lookup was a large share of a chunk): x and z within ±1024 cells of it,
 *  y within ±2^19 cells — 42 bits, exact in a double. */
export class NetVertices {
  readonly map = new Map<number, number>();
  constructor(
    readonly baseCx: number,
    readonly baseCz: number,
  ) {}
  key(cx: number, cy: number, cz: number): number {
    return ((cx - this.baseCx + 1024) * 2048 + (cz - this.baseCz + 1024)) * 0x100000 + (cy + 0x80000);
  }
}

const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
/** The cube's 12 edges as corner index pairs. */
const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const N = BRICK / VOXEL + 1;
const BLOCKS = (N - 1) / BLOCK;
const _blockRock = new Uint8Array(BLOCKS * BLOCKS * BLOCKS);
const _sampleSkip = new Uint8Array(N * N * N);

/** One brick's state while it meshes. */
interface Brick {
  field: FieldFn;
  shared: NetVertices;
  out: NetsOutput;
  samples: Float64Array;
  sx: number;
  sy: number;
  sz: number;
}

const _corner = new Float64Array(8);

/** The vertex of lattice cell (cx, cy, cz) — the mean of its edge crossings — made from the brick's
 *  field if it is not known yet; −1 when the cell has no sign change. */
const cellVertex = (b: Brick, cx: number, cy: number, cz: number): number => {
  const key = b.shared.key(cx, cy, cz);
  const known = b.shared.map.get(key);
  if (known !== undefined) return known;
  const { field, samples } = b;
  const voxel = VOXEL;
  // Inside the brick the samples are at hand; a neighbour's cell is read from the field itself.
  const lx = cx - b.sx;
  const ly = cy - b.sy;
  const lz = cz - b.sz;
  const local = lx >= 0 && lx < N - 1 && ly >= 0 && ly < N - 1 && lz >= 0 && lz < N - 1;
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < 8; c++) {
    const [dx, dy, dz] = CORNERS[c];
    const v = local ? samples[(lx + dx) * N * N + (ly + dy) * N + (lz + dz)] : field((cx + dx) * voxel, (cy + dy) * voxel, (cz + dz) * voxel);
    _corner[c] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(min < 0 && max >= 0)) {
    b.shared.map.set(key, -1);
    return -1;
  }
  let px = 0;
  let py = 0;
  let pz = 0;
  let count = 0;
  for (const [p, q] of EDGES) {
    const vp = _corner[p];
    const vq = _corner[q];
    if ((vp < 0) === (vq < 0)) continue;
    const t = vp / (vp - vq);
    px += CORNERS[p][0] + (CORNERS[q][0] - CORNERS[p][0]) * t;
    py += CORNERS[p][1] + (CORNERS[q][1] - CORNERS[p][1]) * t;
    pz += CORNERS[p][2] + (CORNERS[q][2] - CORNERS[p][2]) * t;
    count++;
  }
  const x = (cx + px / count) * voxel;
  const y = (cy + py / count) * voxel;
  const z = (cz + pz / count) * voxel;
  // The normal faces the air: minus the gradient.
  const eps = NORMAL_EPS * voxel;
  let nx = field(x - eps, y, z) - field(x + eps, y, z);
  let ny = field(x, y - eps, z) - field(x, y + eps, z);
  let nz = field(x, y, z - eps) - field(x, y, z + eps);
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 0) {
    nx /= len;
    ny /= len;
    nz /= len;
  } else ny = 1;
  const index = b.out.positions.length / 3;
  b.out.positions.push(x, y, z);
  b.out.normals.push(nx, ny, nz);
  b.shared.map.set(key, index);
  return index;
};

/** A box (world units) a caller can prove holds only rock (a positive field everywhere inside). */
export type RockTest = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boolean;

/**
 * Meshes one brick whose min corner is at lattice cell (sx, sy, sz): samples its (BRICK/voxel + 1)³
 * lattice points, emits a quad for every owned edge with a sign change between the four cells around
 * it, wound to face the air. Returns false when the brick held no surface. `isRock`: a block of
 * samples whose box PADDED by a voxel is provably rock is not sampled — every cell touching one of its
 * samples then has rock at all eight corners, so the samples are only ever sign-tested and a positive
 * stand-in reads the same (the mesh does not change by a bit; the test pins it).
 */
export const meshBrick = (field: FieldFn, sx: number, sy: number, sz: number, shared: NetVertices, out: NetsOutput, isRock?: RockTest): boolean => {
  const voxel = VOXEL;
  const blockRock = _blockRock;
  const sampleSkip = _sampleSkip;
  const samples = new Float64Array(N * N * N);
  let anyAir = false;
  let anyRock = false;
  let skipping = false;
  if (isRock) {
    for (let bi = 0; bi < BLOCKS; bi++) {
      for (let bj = 0; bj < BLOCKS; bj++) {
        for (let bk = 0; bk < BLOCKS; bk++) {
          const rock = isRock(
            (sx + bi * BLOCK - 1) * voxel,
            (sy + bj * BLOCK - 1) * voxel,
            (sz + bk * BLOCK - 1) * voxel,
            (sx + bi * BLOCK + BLOCK + 1) * voxel,
            (sy + bj * BLOCK + BLOCK + 1) * voxel,
            (sz + bk * BLOCK + BLOCK + 1) * voxel,
          );
          blockRock[(bi * BLOCKS + bj) * BLOCKS + bk] = rock ? 1 : 0;
          if (rock) skipping = true;
        }
      }
    }
    if (skipping) {
      // A sample on a block boundary belongs to both blocks: either settling it settles the sample.
      const blockOf = (i: number, lo: boolean): number => (lo ? Math.floor((i - 1) / BLOCK) : Math.floor(i / BLOCK));
      for (let i = 0; i < N; i++) {
        const il = blockOf(i, true);
        const ih = blockOf(i, false);
        for (let j = 0; j < N; j++) {
          const jl = blockOf(j, true);
          const jh = blockOf(j, false);
          for (let k = 0; k < N; k++) {
            const kl = blockOf(k, true);
            const kh = blockOf(k, false);
            let skip = 0;
            for (let a = il; a <= ih && !skip; a++) {
              if (a < 0 || a >= BLOCKS) continue;
              for (let b = jl; b <= jh && !skip; b++) {
                if (b < 0 || b >= BLOCKS) continue;
                for (let c = kl; c <= kh && !skip; c++) {
                  if (c < 0 || c >= BLOCKS) continue;
                  skip = blockRock[(a * BLOCKS + b) * BLOCKS + c];
                }
              }
            }
            sampleSkip[i * N * N + j * N + k] = skip;
          }
        }
      }
      anyRock = true;
    }
  }
  // y innermost: a column's samples come one after another, so a field reading the ground per (x, z)
  // (chunkMesh.ts) keeps the last column's value.
  for (let i = 0; i < N; i++) {
    const x = (sx + i) * voxel;
    for (let k = 0; k < N; k++) {
      const z = (sz + k) * voxel;
      for (let j = 0; j < N; j++) {
        const index = i * N * N + j * N + k;
        if (skipping && sampleSkip[index]) {
          samples[index] = ROCK_STAND_IN;
          continue;
        }
        const v = field(x, (sy + j) * voxel, z);
        samples[index] = v;
        if (v < 0) anyAir = true;
        else anyRock = true;
      }
    }
  }
  if (!anyAir || !anyRock) return false;
  const brick: Brick = { field, shared, out, samples, sx, sy, sz };
  let emitted = false;
  const vertex = (cx: number, cy: number, cz: number): number => cellVertex(brick, cx, cy, cz);
  const emit = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) out.indices.push(a, d, c, a, c, b);
    else out.indices.push(a, b, c, a, c, d);
    emitted = true;
  };
  const M = N - 1;
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      for (let k = 0; k < M; k++) {
        const v0 = samples[i * N * N + j * N + k];
        const air0 = v0 < 0;
        // x-edge from (i, j, k) to (i+1, j, k): the cells around it vary in y then z.
        if (air0 !== samples[(i + 1) * N * N + j * N + k] < 0) {
          const cx = sx + i;
          emit(vertex(cx, sy + j - 1, sz + k - 1), vertex(cx, sy + j, sz + k - 1), vertex(cx, sy + j, sz + k), vertex(cx, sy + j - 1, sz + k), air0);
        }
        // y-edge: cells vary in z then x.
        if (air0 !== samples[i * N * N + (j + 1) * N + k] < 0) {
          const cy = sy + j;
          emit(vertex(sx + i - 1, cy, sz + k - 1), vertex(sx + i - 1, cy, sz + k), vertex(sx + i, cy, sz + k), vertex(sx + i, cy, sz + k - 1), air0);
        }
        // z-edge: cells vary in x then y.
        if (air0 !== samples[i * N * N + j * N + k + 1] < 0) {
          const cz = sz + k;
          emit(vertex(sx + i - 1, sy + j - 1, cz), vertex(sx + i, sy + j - 1, cz), vertex(sx + i, sy + j, cz), vertex(sx + i - 1, sy + j, cz), air0);
        }
      }
    }
  }
  return emitted;
};
