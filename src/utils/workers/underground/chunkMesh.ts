/**
 * One UndergroundChunk (per 256u dressing chunk, per style and biome): the systems in reach, their
 * walls meshed — caves by surface nets over "air above the drawn ground OR in the tunnel" (so an
 * entrance is one surface), sewers as explicit faces cut at the drawn ground — with per-vertex color
 * and daylight, one
 * trimesh collider per 16u column, the liquid, the entrance patch and the doors. Positions relative
 * to the chunk's center in x/z, absolute in y. Three-free; runs on the tunnel worker (a chunk is
 * 100–400ms).
 */

import { smoothstep } from "../../math/_math";
import type { RectXZ } from "../../math/types";
import { CITY_WIGGLE_AMP, cityDistrictByIndex } from "../roads/cityDistricts";
import { AXIS_LIFT, BRICK, DAYLIGHT_GROUND_DEPTH, DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR, FIELD_REACH, GROUND_CUT_SLACK, GROUND_CUT_SPLIT, SEWER_WALL_COLOR, VOXEL } from "./constants";
import { drawnGroundAt, drawnGroundMinOver, drawnNormalAt, latticeHeightAt, LATTICE } from "./drawnGround";
import { buildPatch, footprintCells, inAnyFootprint, mouthsReaching, type PatchVertex } from "./entrance";
import { layoutDoors, layoutMasks, layoutPieces, mergeLayouts, type SewerLayout } from "./sewers";
import { type PlaneAxis, sewerGeometryOf, sewerPlaneSections } from "./sewerMesh";
import { meshBrick, NetVertices, type NetsOutput } from "./surfaceNets";
import { systemsNear } from "./systems";
import { airMayReach, boundsTouchXZ, boxIsRock, compileField, piecesTouching, rockDipOf, type FieldFn } from "./tunnelField";
import type { Bounds3, ColumnCollider, MouthPiece, SewerDoor, ShaftPiece, SkirtMask, TunnelCap, TunnelEntrance, TunnelPiece, TunnelStyle, TunnelSystem, UndergroundChunk } from "./types";

/** The sound all-rock brick test (tunnelField.ts boxIsRock); off only to pin that it changes no bit (the test). */
let rockTestEnabled = true;
export const setRockTestEnabled = (enabled: boolean): void => {
  rockTestEnabled = enabled;
};

/** A finished triangle vertex: absolute position, normal, linear color, daylight. */
interface Vertex {
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
interface DaylightSource {
  x: number;
  y: number;
  z: number;
  near: number;
  far: number;
}

/** Daylight at a point: from the nearest source and from the ground within DAYLIGHT_GROUND_DEPTH overhead. */
const daylightAt = (lights: readonly DaylightSource[], x: number, y: number, z: number): number => {
  let light = 1 - smoothstep(0, DAYLIGHT_GROUND_DEPTH, drawnGroundAt(x, z) - y);
  for (const l of lights) {
    if (Math.abs(l.x - x) > l.far || Math.abs(l.z - z) > l.far || Math.abs(l.y - y) > l.far) continue;
    const v = 1 - smoothstep(l.near, l.far, Math.sqrt((l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2));
    if (v > light) light = v;
  }
  return light;
};

interface Column {
  key: number;
  x: number;
  z: number;
  vertices: number[];
  indices: number[];
}

/** The chunk's drawn mesh and its colliders, assembled from finished triangles. `colored`: the sewers
 *  carry vertex colors; the cave rock's color is the material's formula (no buffer). */
class ChunkAssembly {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly daylight: number[] = [];
  readonly indices: number[] = [];
  readonly columns = new Map<number, Column>();

  constructor(
    readonly centerX: number,
    readonly centerZ: number,
    readonly minX: number,
    readonly minZ: number,
    readonly colored: boolean,
  ) {}

  /** Adds a drawn triangle of three fresh vertices (the sewers' clipped triangles); `solid` adds it to
   *  its column's collider too. */
  triangle(a: Vertex, b: Vertex, c: Vertex, solid = true): void {
    this.indices.push(this.vertex(a), this.vertex(b), this.vertex(c));
    if (solid) this.collide(a, b, c);
  }

  private vertex(v: Vertex): number {
    const index = this.positions.length / 3;
    this.positions.push(v.x - this.centerX, v.y, v.z - this.centerZ);
    this.normals.push(v.nx, v.ny, v.nz);
    if (this.colored) this.colors.push(v.r, v.g, v.b);
    this.daylight.push(v.light);
    return index;
  }

  /** The nets' vertex ids → this mesh's (and each column's) indices, so a shared vertex is written once. */
  private sharedIndex: Int32Array | null = null;
  private readonly columnIndex = new Map<number, Map<number, number>>();

  /** Adds a drawn triangle of SHARED vertices (`ids` into `vertices`, the surface nets' output): a
   *  vertex is written on its first use and indexed after. */
  triangleShared(vertices: readonly Vertex[], ia: number, ib: number, ic: number, solid = true): void {
    let map = this.sharedIndex;
    if (!map) {
      map = this.sharedIndex = new Int32Array(vertices.length);
      map.fill(-1);
    }
    this.indices.push(this.sharedVertex(vertices, map, ia), this.sharedVertex(vertices, map, ib), this.sharedVertex(vertices, map, ic));
    if (solid) this.collideShared(vertices, ia, ib, ic);
  }

  private sharedVertex(vertices: readonly Vertex[], map: Int32Array, id: number): number {
    let index = map[id];
    if (index < 0) map[id] = index = this.vertex(vertices[id]);
    return index;
  }

  collideShared(vertices: readonly Vertex[], ia: number, ib: number, ic: number): void {
    const col = this.column(vertices[ia], vertices[ib], vertices[ic]);
    let map = this.columnIndex.get(col.key);
    if (!map) this.columnIndex.set(col.key, (map = new Map()));
    col.indices.push(this.columnVertex(col, map, vertices, ia), this.columnVertex(col, map, vertices, ib), this.columnVertex(col, map, vertices, ic));
  }

  private columnVertex(col: Column, map: Map<number, number>, vertices: readonly Vertex[], id: number): number {
    let index = map.get(id);
    if (index === undefined) {
      const v = vertices[id];
      index = col.vertices.length / 3;
      col.vertices.push(v.x - col.x, v.y, v.z - col.z);
      map.set(id, index);
    }
    return index;
  }

  private column(a: Vertex, b: Vertex, c: Vertex): Column {
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const ix = Math.floor((cx - this.minX) / BRICK);
    const iz = Math.floor((cz - this.minZ) / BRICK);
    const key = ix * 64 + iz;
    let col = this.columns.get(key);
    if (!col) {
      col = { key, x: this.minX + (ix + 0.5) * BRICK, z: this.minZ + (iz + 0.5) * BRICK, vertices: [], indices: [] };
      this.columns.set(key, col);
    }
    return col;
  }

  collide(a: Vertex, b: Vertex, c: Vertex): void {
    const col = this.column(a, b, c);
    for (const v of [a, b, c]) {
      col.indices.push(col.vertices.length / 3);
      col.vertices.push(v.x - col.x, v.y, v.z - col.z);
    }
  }

  mesh() {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      daylight: new Float32Array(this.daylight),
      indices: new Uint32Array(this.indices),
    };
  }

  colliders(): ColumnCollider[] {
    return Array.from(this.columns.values(), (c) => ({ x: c.x, z: c.z, vertices: new Float32Array(c.vertices), indices: new Uint32Array(c.indices) }));
  }
}

const lerpVertex = (a: Vertex, b: Vertex, t: number): Vertex => {
  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const nz = a.nz + (b.nz - a.nz) * t;
  const len = Math.hypot(nx, ny, nz) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    nx: nx / len,
    ny: ny / len,
    nz: nz / len,
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    light: a.light + (b.light - a.light) * t,
  };
};

const blend3 = (a: Vertex, b: Vertex, c: Vertex, wa: number, wb: number, wc: number): Vertex => {
  const nx = a.nx * wa + b.nx * wb + c.nx * wc;
  const ny = a.ny * wa + b.ny * wb + c.ny * wc;
  const nz = a.nz * wa + b.nz * wb + c.nz * wc;
  const len = Math.hypot(nx, ny, nz) || 1;
  return {
    x: a.x * wa + b.x * wb + c.x * wc,
    y: a.y * wa + b.y * wb + c.y * wc,
    z: a.z * wa + b.z * wb + c.z * wc,
    nx: nx / len,
    ny: ny / len,
    nz: nz / len,
    r: a.r * wa + b.r * wb + c.r * wc,
    g: a.g * wa + b.g * wb + c.g * wc,
    b: a.b * wa + b.b * wb + c.b * wc,
    light: a.light * wa + b.light * wb + c.light * wc,
  };
};

/** A wall standing more than GROUND_CUT_SLACK over the drawn ground: how far (negative = under). */
const overGround = (v: Vertex): number => v.y - (drawnGroundAt(v.x, v.z) + GROUND_CUT_SLACK);

/** The height under which a triangle is wholly under the drawn ground (plus the slack): the lowest
 *  lattice point of the cells its footprint touches — a sound bound, since the drawn surface is
 *  linear over each triangle of the lattice. */
const underGround = (a: Vertex, b: Vertex, c: Vertex): number =>
  drawnGroundMinOver(Math.min(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.z, b.z, c.z)) + GROUND_CUT_SLACK;

/** Clips a triangle to the part under the drawn ground, splitting it first so the cut follows the
 *  surface. Emits what is left. A triangle wholly under the ground (`deepUnder`, from underGround) is
 *  emitted whole: split, every piece would be kept, and the pieces of a flat triangle draw as it does
 *  (a sewer chunk went 151k → 9k triangles, DECISIONS.md). */
const cutAtGround = (a: Vertex, b: Vertex, c: Vertex, emit: (a: Vertex, b: Vertex, c: Vertex) => void, deepUnder: number): void => {
  const top = Math.max(a.y, b.y, c.y);
  if (top < deepUnder) {
    emit(a, b, c);
    return;
  }
  // Split by the HORIZONTAL extent: the ground is a function of (x, z), so a plumb face clips exactly
  // along its vertical edges however tall it is. Split by its true length, a shaft's 48u facet became
  // 64 triangles with seven vertices on the ceiling rim's edge — T-junctions the sky showed through.
  const longest = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(b.x - c.x, b.z - c.z), Math.hypot(c.x - a.x, c.z - a.z));
  const n = Math.min(8, Math.max(1, Math.ceil(longest / GROUND_CUT_SPLIT)));
  // Barycentric: a + (b − a) i/n + (c − a) j/n.
  const at = (i: number, j: number): Vertex => blend3(a, b, c, 1 - i / n - j / n, i / n, j / n);
  const clip = (p: Vertex, q: Vertex, r: Vertex): void => {
    const op = overGround(p);
    const oq = overGround(q);
    const or = overGround(r);
    const inside = [op <= 0, oq <= 0, or <= 0];
    const count = inside.filter(Boolean).length;
    if (count === 0) return;
    if (count === 3) {
      emit(p, q, r);
      return;
    }
    const vs = [p, q, r];
    const os = [op, oq, or];
    let k = 0;
    while (inside[k] === (count === 2)) k++;
    const v0 = vs[k], v1 = vs[(k + 1) % 3], v2 = vs[(k + 2) % 3];
    const o0 = os[k], o1 = os[(k + 1) % 3], o2 = os[(k + 2) % 3];
    const m01 = lerpVertex(v0, v1, o0 / (o0 - o1));
    const m02 = lerpVertex(v0, v2, o0 / (o0 - o2));
    if (count === 1) emit(v0, m01, m02);
    else {
      emit(v1, v2, m02);
      emit(v1, m02, m01);
    }
  };
  if (n === 1) {
    clip(a, b, c);
    return;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) {
      const p00 = at(i, j);
      const p10 = at(i + 1, j);
      const p01 = at(i, j + 1);
      clip(p00, p10, p01);
      if (i + j < n - 1) clip(p10, at(i + 1, j + 1), p01);
    }
  }
};

/** A polygon's part inside a chunk's rectangle (Sutherland–Hodgman in x/z, every attribute interpolated
 *  by `lerp`): a polygon on a chunk edge is drawn by both chunks, each its own part, so every drawn
 *  triangle belongs wholly to the chunk holding it. Empty when nothing is left. */
const clipPolygonToRect = <T>(polygon: readonly T[], rect: RectXZ, xOf: (p: T) => number, zOf: (p: T) => number, lerp: (p: T, q: T, t: number) => T): T[] => {
  let poly: T[] = polygon.slice();
  const planes: [number, number, number][] = [
    [1, 0, -rect.minX],
    [-1, 0, rect.maxX],
    [0, 1, -rect.minZ],
    [0, -1, rect.maxZ],
  ];
  for (const [ax, az, k] of planes) {
    const next: T[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = ax * xOf(p) + az * zOf(p) + k;
      const dq = ax * xOf(q) + az * zOf(q) + k;
      if (dp >= 0) next.push(p);
      if (dp >= 0 !== dq >= 0) next.push(lerp(p, q, dp / (dp - dq)));
    }
    poly = next;
    if (poly.length < 3) return [];
  }
  return poly;
};

const vertexX = (v: Vertex): number => v.x;
const vertexZ = (v: Vertex): number => v.z;

/** A triangle's part inside the chunk, as a fan of triangles. */
const clipTriangleToRect = (a: Vertex, b: Vertex, c: Vertex, rect: RectXZ): Vertex[][] => {
  const poly = clipPolygonToRect([a, b, c], rect, vertexX, vertexZ, lerpVertex);
  const out: Vertex[][] = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  return out;
};

type P3 = [number, number, number];
const p3X = (p: P3): number => p[0];
const p3Z = (p: P3): number => p[2];
const lerpP3 = (p: P3, q: P3, t: number): P3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/** Convex polygons (absolute) clipped to the chunk and fanned into a liquid surface relative to its center. */
const clipLiquid = (polygons: readonly P3[][], b: RectXZ, centerX: number, centerZ: number): UndergroundChunk["liquid"] => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const points of polygons) {
    const poly = clipPolygonToRect(points, b, p3X, p3Z, lerpP3);
    if (poly.length < 3) continue;
    const base = positions.length / 3;
    for (const p of poly) positions.push(p[0] - centerX, p[1], p[2] - centerZ);
    for (let k = 1; k + 1 < poly.length; k++) indices.push(base, base + k, base + k + 1);
  }
  return positions.length > 0 ? { positions: new Float32Array(positions), indices: new Uint32Array(indices) } : null;
};

const entrancesIn = (entrances: readonly TunnelEntrance[], b: RectXZ): TunnelEntrance[] =>
  entrances.filter((e) => e.x >= b.minX && e.x < b.maxX && e.z >= b.minZ && e.z < b.maxZ);

const masksTouching = (masks: readonly SkirtMask[], b: RectXZ): SkirtMask[] =>
  masks.filter((m) => Math.min(m.ax, m.bx) - m.radius <= b.maxX && Math.max(m.ax, m.bx) + m.radius >= b.minX && Math.min(m.az, m.bz) - m.radius <= b.maxZ && Math.max(m.az, m.bz) + m.radius >= b.minZ);

// ── The nets over a chunk ────────────────────────────────────────────────

/** The lowest lattice height over a square padded by `pad` on every side (plus one cell). */
const lowestGroundOver = (x0: number, z0: number, size: number, pad: number): number => {
  let lowest = Infinity;
  for (let m = Math.floor((x0 - pad) / LATTICE); m <= Math.floor((x0 + size + pad) / LATTICE) + 1; m++) {
    for (let n = Math.floor((z0 - pad) / LATTICE); n <= Math.floor((z0 + size + pad) / LATTICE) + 1; n++) {
      const h = latticeHeightAt(m, n);
      if (h < lowest) lowest = h;
    }
  }
  return lowest;
};

/** The lowest and highest lattice heights over a square (plus one cell). */
const groundRangeOver = (x0: number, z0: number, size: number): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (let m = Math.floor(x0 / LATTICE); m <= Math.floor((x0 + size) / LATTICE) + 1; m++) {
    for (let n = Math.floor(z0 / LATTICE); n <= Math.floor((z0 + size) / LATTICE) + 1; n++) {
      const h = latticeHeightAt(m, n);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
};

/** Which columns are FOOT columns: an entrance opens to the sky there, so the field takes the ground
 *  in and the bricks around the ground are meshed. */
interface NetsStyle {
  footAt: (minX: number, minZ: number, maxX: number, maxZ: number) => boolean;
}

/** Meshes one BRICK-wide column of bricks: every brick the pieces' air can reach (plus, in a foot
 *  column, the bricks around the ground), over the field "air above the drawn ground OR in the
 *  tunnel", bricks provably all rock skipped. */
const meshColumn = (x0: number, z0: number, columnPieces: readonly TunnelPiece[], foot: boolean, shared: NetVertices, nets: NetsOutput): void => {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of columnPieces) {
    if (p.bounds.minY < yMin) yMin = p.bounds.minY;
    if (p.bounds.maxY > yMax) yMax = p.bounds.maxY;
  }
  // The lowest drawn ground a brick of the column can read: its field is asked up to a voxel outside
  // it (the neighbouring cells' vertices, the normals), so the lattice cells are padded by one.
  const groundFloor = lowestGroundOver(x0, z0, BRICK, 2);
  let groundMin = Infinity;
  let groundMax = -Infinity;
  if (foot) {
    ({ min: groundMin, max: groundMax } = groundRangeOver(x0, z0, BRICK));
    yMin = Math.min(yMin, groundMin - 2);
    yMax = Math.max(yMax, groundMax + 2);
  }
  const brick0 = Math.floor((yMin - FIELD_REACH) / BRICK) * BRICK;
  const brick1 = Math.ceil((yMax + FIELD_REACH) / BRICK) * BRICK;
  for (let y0 = brick0; y0 < brick1; y0 += BRICK) {
    const box: Bounds3 = { minX: x0, minY: y0, minZ: z0, maxX: x0 + BRICK, maxY: y0 + BRICK, maxZ: z0 + BRICK };
    const inFoot = foot && y0 <= groundMax + 2 && y0 + BRICK >= groundMin - 2;
    if (!inFoot && !airMayReach(columnPieces, box)) continue;
    if (!inFoot && rockTestEnabled && boxIsRock(columnPieces, box)) continue;
    // Padded a voxel past FIELD_REACH: the neighbouring cells' vertices and the normals read a voxel outside the brick.
    const brickPieces = piecesTouching(columnPieces, box, FIELD_REACH + VOXEL);
    const tunnel = compileField(brickPieces);
    // Blocks of samples settled as rock by the sound bound (surfaceNets.ts meshBrick): the tunnel
    // field's bound, and the ground's — the block must lie wholly under the column's lowest ground.
    const dip = rockDipOf(brickPieces);
    const blockIsRock = rockTestEnabled
      ? (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean =>
          maxY <= groundFloor && boxIsRock(brickPieces, { minX, minY, minZ, maxX, maxY, maxZ }, dip)
      : undefined;
    // The ground term can only win within FIELD_REACH of the ground (the tunnel field never exceeds
    // it): a brick deeper than that reads the tunnel alone, and the rest read the ground once per
    // (x, z) column (meshBrick samples a column at a time).
    let field: FieldFn = tunnel;
    if (y0 + BRICK + 1 + FIELD_REACH >= groundFloor) {
      let lastX = NaN;
      let lastZ = NaN;
      let lastGround = 0;
      field = (x, y, z) => {
        const t = tunnel(x, y, z);
        if (x !== lastX || z !== lastZ) {
          lastX = x;
          lastZ = z;
          lastGround = drawnGroundAt(x, z);
        }
        const g = lastGround - y;
        return g < t ? g : t;
      };
    }
    meshBrick(field, Math.round(x0 / VOXEL), Math.round(y0 / VOXEL), Math.round(z0 / VOXEL), shared, nets, blockIsRock);
  }
};

/** The surface nets of every column of the chunk the pieces reach. */
const meshChunk = (b: RectXZ, pieces: readonly TunnelPiece[], style: NetsStyle): NetsOutput => {
  const nets: NetsOutput = { positions: [], normals: [], indices: [] };
  const shared = new NetVertices(Math.round(b.minX / VOXEL), Math.round(b.minZ / VOXEL));
  const columns = Math.round((b.maxX - b.minX) / BRICK);
  for (let a = 0; a < columns; a++) {
    for (let c = 0; c < columns; c++) {
      const x0 = b.minX + a * BRICK;
      const z0 = b.minZ + c * BRICK;
      const columnPieces = pieces.filter((p) => boundsTouchXZ(p.bounds, x0, z0, x0 + BRICK, z0 + BRICK, FIELD_REACH + VOXEL));
      const foot = style.footAt(x0, z0, x0 + BRICK, z0 + BRICK);
      if (columnPieces.length === 0 && !foot) continue;
      meshColumn(x0, z0, columnPieces, foot, shared, nets);
    }
  }
  return nets;
};

/** The nets' vertices finished: ground vertices (the ground term won the field there) snapped onto the
 *  drawn ground with its normals, every vertex lit. */
const finishVertices = (nets: NetsOutput, tunnelAll: FieldFn, lights: readonly DaylightSource[]): { vertices: Vertex[]; isGround: boolean[] } => {
  const count = nets.positions.length / 3;
  const vertices: Vertex[] = new Array(count);
  const isGround: boolean[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const x = nets.positions[i * 3];
    let y = nets.positions[i * 3 + 1];
    const z = nets.positions[i * 3 + 2];
    const ground = drawnGroundAt(x, z);
    const groundVertex = ground - y <= tunnelAll(x, y, z);
    isGround[i] = groundVertex;
    let nx = nets.normals[i * 3];
    let ny = nets.normals[i * 3 + 1];
    let nz = nets.normals[i * 3 + 2];
    if (groundVertex) {
      y = ground;
      const n = drawnNormalAt(x, z);
      nx = n.x;
      ny = n.y;
      nz = n.z;
    }
    vertices[i] = { x, y, z, nx, ny, nz, r: 0, g: 0, b: 0, light: daylightAt(lights, x, y, z) };
  }
  return { vertices, isGround };
};

// ── Caves ────────────────────────────────────────────────────────────────

/** Sorts the nets' triangles: inside a mouth's footprint they are the PATCH (solid where they are not
 *  the ground, which the heightfield is already); outside, the ground's own triangles are dropped (the
 *  terrain is there) and the rest are the walls. */
const sortCaveTriangles = (nets: NetsOutput, vertices: readonly Vertex[], isGround: readonly boolean[], footMouths: readonly MouthPiece[], assembly: ChunkAssembly): { patchVertices: PatchVertex[]; patchIndices: number[] } => {
  const patchVertices: PatchVertex[] = [];
  const patchIndex = new Map<number, number>();
  const patchIndices: number[] = [];
  const patchOf = (i: number): number => {
    let k = patchIndex.get(i);
    if (k === undefined) {
      const v = vertices[i];
      k = patchVertices.length;
      patchVertices.push({ x: v.x, y: v.y, z: v.z, nx: v.nx, ny: v.ny, nz: v.nz, ground: isGround[i], daylight: v.light });
      patchIndex.set(i, k);
    }
    return k;
  };
  for (let t = 0; t < nets.indices.length; t += 3) {
    const ia = nets.indices[t];
    const ib = nets.indices[t + 1];
    const ic = nets.indices[t + 2];
    const a = vertices[ia];
    const bv = vertices[ib];
    const c = vertices[ic];
    const cx = (a.x + bv.x + c.x) / 3;
    const cz = (a.z + bv.z + c.z) / 3;
    if (footMouths.length > 0 && inAnyFootprint(footMouths, cx, cz)) {
      patchIndices.push(patchOf(ia), patchOf(ib), patchOf(ic));
      const groundCorners = (isGround[ia] ? 1 : 0) + (isGround[ib] ? 1 : 0) + (isGround[ic] ? 1 : 0);
      if (groundCorners < 2) assembly.collideShared(vertices, ia, ib, ic);
      continue;
    }
    if (isGround[ia] && isGround[ib] && isGround[ic]) continue;
    assembly.triangleShared(vertices, ia, ib, ic);
  }
  return { patchVertices, patchIndices };
};

const buildCaveChunk = (b: RectXZ, biomeId: number): UndergroundChunk | null => {
  const systems = systemsNear("cave", biomeId, b, FIELD_REACH + BRICK);
  const mouths = systems.flatMap((s) => s.mouths);
  const footMouths = mouthsReaching(mouths, b.minX, b.minZ, b.maxX, b.maxZ);
  const pieces = systems.flatMap((s) => s.pieces).filter((p) => boundsTouchXZ(p.bounds, b.minX, b.minZ, b.maxX, b.maxZ, FIELD_REACH + VOXEL));
  if (pieces.length === 0 && footMouths.length === 0) return null;
  const centerX = (b.minX + b.maxX) / 2;
  const centerZ = (b.minZ + b.maxZ) / 2;
  const assembly = new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, false);
  const lights: DaylightSource[] = mouths.map((m) => ({ x: m.ox, y: m.oy + AXIS_LIFT * m.r0, z: m.oz, near: DAYLIGHT_MOUTH_NEAR, far: DAYLIGHT_MOUTH_FAR }));

  const nets = meshChunk(b, pieces, { footAt: (x0, z0, x1, z1) => footMouths.length > 0 && mouthsReaching(footMouths, x0, z0, x1, z1).length > 0 });
  const { vertices, isGround } = finishVertices(nets, compileField(pieces), lights);
  const { patchVertices, patchIndices } = sortCaveTriangles(nets, vertices, isGround, footMouths, assembly);

  // The spring caves' standing water, clipped to the chunk (the sewers' liquid, the same way): only
  // swum in — the terrain's water sheet draws it (springWater.ts).
  const liquid = clipLiquid(
    systems.flatMap((s) => (s.liquid ?? []).map((w) => w.points)),
    b,
    centerX,
    centerZ,
  );

  const entrances = systems.flatMap((s) => s.entrances);
  return {
    style: "cave",
    centerX,
    centerZ,
    pieces,
    entrances: entrancesIn(entrances, b),
    systemEntrances: entrances,
    masks: masksTouching(
      systems.flatMap((s) => s.masks),
      b,
    ),
    mesh: assembly.mesh(),
    colliders: assembly.colliders(),
    liquid,
    patch: patchVertices.length > 0 ? buildPatch(patchVertices, patchIndices, centerX, centerZ) : null,
    entranceMouths: footMouths.map((m) => ({ id: m.id, cells: footprintCells(m) })),
    doors: [],
    caps: [],
  };
};

// ── Sewers ───────────────────────────────────────────────────────────────

/** Every system of a district (the whole district's area, so every chunk merges the same set). */
const districtSystems = (biomeId: number, district: string, sample: TunnelSystem): TunnelSystem[] => {
  const [r, m] = district.split(",").map(Number);
  const d = cityDistrictByIndex(r, m);
  const area = { minX: d.minX - CITY_WIGGLE_AMP, minZ: d.minZ - CITY_WIGGLE_AMP, maxX: d.maxX + CITY_WIGGLE_AMP, maxZ: d.maxZ + CITY_WIGGLE_AMP };
  const all = systemsNear("sewer", biomeId, area, 0).filter((s) => s.district === district);
  if (!all.includes(sample)) all.push(sample);
  return all;
};

/** One of the chunk's four borders: its plane and run, the chunk on the other side, the normal INTO the chunk. */
interface ChunkBorder {
  neighbor: string;
  axis: PlaneAxis;
  at: number;
  lo: number;
  hi: number;
  nx: number;
  nz: number;
}

const bordersOf = (b: RectXZ): ChunkBorder[] => {
  const size = b.maxX - b.minX;
  return [
    { neighbor: `${b.minX - size},${b.minZ}`, axis: "x", at: b.minX, lo: b.minZ, hi: b.maxZ, nx: 1, nz: 0 },
    { neighbor: `${b.maxX},${b.minZ}`, axis: "x", at: b.maxX, lo: b.minZ, hi: b.maxZ, nx: -1, nz: 0 },
    { neighbor: `${b.minX},${b.minZ - size}`, axis: "z", at: b.minZ, lo: b.minX, hi: b.maxX, nx: 0, nz: 1 },
    { neighbor: `${b.minX},${b.maxZ}`, axis: "z", at: b.maxZ, lo: b.minX, hi: b.maxX, nx: 0, nz: -1 },
  ];
};

/** What a chunk collects from each district it touches. */
interface SewerChunkParts {
  pieces: TunnelPiece[];
  entrances: TunnelEntrance[];
  systemEntrances: TunnelEntrance[];
  masks: SkirtMask[];
  doors: SewerDoor[];
  liquid: P3[][];
  /** The border caps' triangles, per border (bordersOf order). */
  caps: ChunkAssembly[];
}

/** The border's CAPS from one district: every section of the plane fanned to face into the chunk, in
 *  the walls' color under the walls' daylight (a cap by a manhole is lit as its walls are: a wall end,
 *  not a black plate). */
const addBorderCaps = (layout: SewerLayout, border: ChunkBorder, lights: readonly DaylightSource[], assembly: ChunkAssembly): void => {
  const [r, g, bl] = SEWER_WALL_COLOR;
  const vertex = (p: P3): Vertex => ({ x: p[0], y: p[1], z: p[2], nx: border.nx, ny: 0, nz: border.nz, r, g, b: bl, light: daylightAt(lights, p[0], p[1], p[2]) });
  for (const polygon of sewerPlaneSections(layout, border.axis, border.at, border.lo, border.hi)) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of polygon) {
      cx += p[0] / polygon.length;
      cy += p[1] / polygon.length;
      cz += p[2] / polygon.length;
    }
    const center = vertex([cx, cy, cz]);
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      // Wound to face into the chunk: the fan's normal against the border's inward normal.
      const ux = p[0] - cx;
      const uy = p[1] - cy;
      const uz = p[2] - cz;
      const vx = q[0] - cx;
      const vy = q[1] - cy;
      const vz = q[2] - cz;
      const facing = (uy * vz - uz * vy) * border.nx + (ux * vy - uy * vx) * border.nz;
      if (facing >= 0) assembly.triangle(center, vertex(p), vertex(q), false);
      else assembly.triangle(center, vertex(q), vertex(p), false);
    }
  }
};

/** A merged district layout's share of the chunk: its pieces in reach, its manholes (and their
 *  daylight), masks and doors in the chunk, its faces clipped to the chunk and cut at the drawn
 *  ground, and its liquid. */
const addDistrictToSewerChunk = (layout: SewerLayout, district: string, b: RectXZ, assembly: ChunkAssembly, parts: SewerChunkParts): void => {
  const layoutAll = layoutPieces(layout, district);
  for (const p of layoutAll) if (boundsTouchXZ(p.bounds, b.minX, b.minZ, b.maxX, b.maxZ, FIELD_REACH)) parts.pieces.push(p);
  const lights: DaylightSource[] = [];
  const districtEntrances: TunnelEntrance[] = [];
  for (const n of layout.nodes.values()) {
    if (!n.manhole || !n.manholeInfo) continue;
    const shaft = layoutAll.find((p): p is ShaftPiece => p.kind === "shaft" && p.id === `manhole|${n.key}`);
    if (!shaft) continue;
    districtEntrances.push({ kind: "manhole", id: shaft.id, x: shaft.x, y: n.manholeInfo.streetY, z: shaft.z, dirX: n.manholeInfo.faceX, dirZ: n.manholeInfo.faceZ, radius: shaft.radius, manhole: n.manholeInfo });
    lights.push({ x: shaft.x, y: n.manholeInfo.streetY, z: shaft.z, near: DAYLIGHT_MANHOLE_NEAR, far: DAYLIGHT_MANHOLE_FAR });
  }
  parts.systemEntrances.push(...districtEntrances);
  parts.entrances.push(...entrancesIn(districtEntrances, b));
  parts.masks.push(...masksTouching(layoutMasks(layout), b));
  for (const d of layoutDoors(layout)) if (d.x >= b.minX && d.x < b.maxX && d.z >= b.minZ && d.z < b.maxZ) parts.doors.push(d);

  const geometry = sewerGeometryOf(layout);
  const emit = (u: Vertex, v: Vertex, w: Vertex): void => assembly.triangle(u, v, w);
  const tri = geometry.triangles;
  const vertexAt = (k: number): Vertex => {
    const x = tri.positions[k * 3];
    const y = tri.positions[k * 3 + 1];
    const z = tri.positions[k * 3 + 2];
    return { x, y, z, nx: tri.normals[k * 3], ny: tri.normals[k * 3 + 1], nz: tri.normals[k * 3 + 2], r: tri.colors[k * 3], g: tri.colors[k * 3 + 1], b: tri.colors[k * 3 + 2], light: daylightAt(lights, x, y, z) };
  };
  const triangleCount = tri.positions.length / 9;
  // Each chunk clips the district's triangles to its own border: the two sides reach the border's
  // points through the same arithmetic and the same lattice snap, so they meet exactly (measured: the
  // 93 edges either chunk draws on a shared border are identical).
  const drawRect: RectXZ = { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ };
  for (let t = 0; t < triangleCount; t++) {
    const xs = [tri.positions[t * 9], tri.positions[t * 9 + 3], tri.positions[t * 9 + 6]];
    const zs = [tri.positions[t * 9 + 2], tri.positions[t * 9 + 5], tri.positions[t * 9 + 8]];
    if (Math.max(...xs) < drawRect.minX || Math.min(...xs) >= drawRect.maxX || Math.max(...zs) < drawRect.minZ || Math.min(...zs) >= drawRect.maxZ) continue;
    for (const [p, q, r] of clipTriangleToRect(vertexAt(t * 3), vertexAt(t * 3 + 1), vertexAt(t * 3 + 2), drawRect)) {
      cutAtGround(p, q, r, emit, underGround(p, q, r));
    }
  }
  parts.liquid.push(...geometry.liquid.quads);
  bordersOf(b).forEach((border, i) => addBorderCaps(layout, border, lights, parts.caps[i]));
};

const buildSewerChunk = (b: RectXZ, biomeId: number): UndergroundChunk | null => {
  const near = systemsNear("sewer", biomeId, b, FIELD_REACH + BRICK);
  if (near.length === 0) return null;
  const districts = new Map<string, TunnelSystem>();
  for (const s of near) if (s.district && !districts.has(s.district)) districts.set(s.district, s);
  const centerX = (b.minX + b.maxX) / 2;
  const centerZ = (b.minZ + b.maxZ) / 2;
  const assembly = new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, true);
  const parts: SewerChunkParts = { pieces: [], entrances: [], systemEntrances: [], masks: [], doors: [], liquid: [], caps: bordersOf(b).map(() => new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, true)) };
  for (const [district, sample] of districts) {
    addDistrictToSewerChunk(mergeLayouts(district, districtSystems(biomeId, district, sample)), district, b, assembly, parts);
  }
  if (parts.pieces.length === 0) return null;
  return {
    style: "sewer",
    centerX,
    centerZ,
    pieces: parts.pieces,
    entrances: parts.entrances,
    systemEntrances: parts.systemEntrances,
    masks: parts.masks,
    mesh: assembly.mesh(),
    colliders: assembly.colliders(),
    liquid: clipLiquid(parts.liquid, b, centerX, centerZ),
    patch: null,
    entranceMouths: [],
    doors: parts.doors,
    caps: bordersOf(b)
      .map((border, i): TunnelCap => ({ neighbor: border.neighbor, mesh: parts.caps[i].mesh() }))
      .filter((cap) => cap.mesh.indices.length > 0),
  };
};

/** The chunk for a dressing chunk's bounds, or null when nothing of the style reaches it. */
export const buildUndergroundChunk = (b: RectXZ, style: TunnelStyle, biomeId: number): UndergroundChunk | null =>
  style === "cave" ? buildCaveChunk(b, biomeId) : buildSewerChunk(b, biomeId);
