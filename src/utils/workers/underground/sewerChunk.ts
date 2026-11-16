/**
 * A SEWER chunk (per 256u streaming chunk and biome): every district layout in reach, its explicit faces
 * (sewerMesh.ts) clipped to the chunk and cut at the drawn ground, with per-vertex color and daylight
 * from the manholes; the column colliders, the liquid, the doors and the border caps. Positions relative
 * to the chunk's center in x/z, absolute in y. Three-free.
 */

import type { RectXZ } from "../../math/types";
import { BRICK, DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, FIELD_REACH, GROUND_CUT_SLACK, GROUND_CUT_SPLIT, SEWER_WALL_COLOR } from "./constants";
import { ChunkAssembly, daylightAt, masksTouching, type DaylightSource, type Vertex } from "./assembly";
import { drawnGroundAt, drawnGroundMinOver } from "./drawnGround";
import { districtLayoutsNear } from "./districts";
import { layoutDoors, layoutMasks, layoutPieces, manholeIdOf, type SewerLayout } from "./sewers";
import { type PlaneAxis, sewerGeometryOf, sewerPlaneSections } from "./sewerMesh";
import { boundsTouchXZ } from "./tunnelField";
import type { SewerDoor, ShaftPiece, SkirtMask, TunnelCap, TunnelEntrance, TunnelPiece, UndergroundChunk } from "./types";

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
    const shaft = layoutAll.find((p): p is ShaftPiece => p.kind === "shaft" && p.id === manholeIdOf(layout.district, n));
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

export const buildSewerChunk = (b: RectXZ, biomeId: number): UndergroundChunk | null => {
  const layouts = districtLayoutsNear(biomeId, b, FIELD_REACH + BRICK);
  if (layouts.size === 0) return null;
  const centerX = (b.minX + b.maxX) / 2;
  const centerZ = (b.minZ + b.maxZ) / 2;
  const assembly = new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, true);
  const parts: SewerChunkParts = { pieces: [], entrances: [], systemEntrances: [], masks: [], doors: [], liquid: [], caps: bordersOf(b).map(() => new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, true)) };
  for (const [district, layout] of layouts) addDistrictToSewerChunk(layout, district, b, assembly, parts);
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
    mouths: [],
    doors: parts.doors,
    caps: bordersOf(b)
      .map((border, i): TunnelCap => ({ neighbor: border.neighbor, mesh: parts.caps[i].mesh() }))
      .filter((cap) => cap.mesh.indices.length > 0),
  };
};
