/**
 * The sewers' walls as EXPLICIT geometry (not an isosurface): level, plumb or arch faces only, wound
 * to face the air. Boxes (junctions, rooms, side rooms) are floors cut at the channel and pool edges
 * with plumb steps, walls filled around their openings and ceilings around the shafts; pipes are one
 * profile extruded wall to wall in slices; shafts are 16-sided. Built once per merged district layout
 * (absolute coordinates); a chunk takes the triangles whose centroid it holds. Three-free.
 */

import { QUANTIZATION_GRID } from "../../../world/constants";
import { dropOldestHalf } from "../cellCache";
import {
  CHANNEL_DEPTH,
  CHANNEL_HALF,
  CHANNEL_OVERRUN,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  LIQUID_BELOW_WALKWAY,
  PIPE_AXIS_LIFT,
  PIPE_RADIUS,
  PIPE_SLICE,
  POOL_DEPTH,
  REVEAL_DEPTH,
  SEWER_GRAIN,
  SEWER_SLIME_COLOR,
  SEWER_WALKWAY_COLOR,
  SEWER_WALL_COLOR,
  SHAFT_ABOVE_STREET,
  SHAFT_CORNER_IN,
  SHAFT_RADIUS,
  SHAFT_SIDES,
  SIDE_ROOM_HALF,
  SIDE_ROOM_HEIGHT,
  SIDE_ROOM_HEIGHTS,
} from "./constants";
import { boxHalf, boxHeight, districtAxes, poolHalf, SEWER_DIRS, sideRoomOf, streetFrameOf, type SewerLayout, type SewerNode } from "./sewers";
import { pipeFloorAt, wallNoise } from "./tunnelField";

/** Where the pipe's arch meets the walkway level: the half chord of the circle at the floor. */
const ARCH_FOOT = Math.sqrt(PIPE_RADIUS * PIPE_RADIUS - PIPE_AXIS_LIFT * PIPE_AXIS_LIFT);
const ARCH_SEGMENTS = 16;
/** The arch's angles from its right foot over the crown to its left foot. */
const ARCH_START = Math.asin(-PIPE_AXIS_LIFT / PIPE_RADIUS);
const ARCH_END = Math.PI - ARCH_START;

export interface SewerTriangles {
  positions: number[];
  normals: number[];
  colors: number[];
}

type P3 = [number, number, number];

const grain = (c: readonly [number, number, number], x: number, y: number, z: number): P3 => {
  const g = 1 + SEWER_GRAIN * wallNoise(x * 0.5, y * 0.5, z * 0.5);
  return [c[0] * g, c[1] * g, c[2] * g];
};

/** Every vertex is snapped to the shader's own quantization lattice before it is written: the faces meeting
 *  at a join (a pipe's end ring, the wall's arch outline) reach the same points through different
 *  arithmetic, and the shader snapped them a lattice step apart at a few percent of vertices — a dotted
 *  seam along every join (DECISIONS.md "The sewer joins"). On the lattice already, they stay one point. */
const snap = (v: number): number => Math.round(v / QUANTIZATION_GRID) * QUANTIZATION_GRID;

const pushVertex = (out: SewerTriangles, p: P3, n: P3, c: readonly [number, number, number]): void => {
  out.positions.push(snap(p[0]), snap(p[1]), snap(p[2]));
  out.normals.push(n[0], n[1], n[2]);
  const col = grain(c, p[0], p[1], p[2]);
  out.colors.push(col[0], col[1], col[2]);
};

/** A quad (four corners in order) facing `hint`: flat-shaded unless `normals` gives one per corner. */
const quad = (out: SewerTriangles, c: P3[], hint: P3, color: readonly [number, number, number], normals?: P3[]): void => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < 4; k++) {
    const p = c[k];
    const q = c[(k + 1) % 4];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return;
  nx /= len;
  ny /= len;
  nz /= len;
  let order = [0, 1, 2, 0, 2, 3];
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    order = [0, 2, 1, 0, 3, 2];
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  for (const k of order) pushVertex(out, c[k], normals ? normals[k] : [nx, ny, nz], color);
};

const tri = (out: SewerTriangles, a: P3, b: P3, c: P3, hint: P3, color: readonly [number, number, number]): void => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return;
  nx /= len;
  ny /= len;
  nz /= len;
  let order: P3[] = [a, b, c];
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    order = [a, c, b];
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  for (const p of order) pushVertex(out, p, [nx, ny, nz], color);
};

/** The annulus between a convex hole and the outline of the face around it (star-shaped about the
 *  hole's center), as one strip: the two rings walked together in angle order, a triangle per step.
 *  Only the rings' own vertices are used, so the outline's edge stays the walls' edge. `map` takes
 *  the plane's (s, t) to the world. */
const fillAroundHole = (
  out: SewerTriangles,
  outline: [number, number][],
  hole: [number, number][],
  center: [number, number],
  map: (s: number, t: number) => P3,
  hint: P3,
  color: readonly [number, number, number],
): void => {
  const [cs, ct] = center;
  const ring = (pts: [number, number][]) => pts.map((p) => ({ ang: Math.atan2(p[1] - ct, p[0] - cs), p })).sort((a, b) => a.ang - b.ang);
  const H = ring(hole);
  const B = ring(outline);
  let i = 0;
  let j = 0;
  while (i < H.length || j < B.length) {
    const h = H[i % H.length];
    const b = B[j % B.length];
    const hNext = H[(i + 1) % H.length];
    const bNext = B[(j + 1) % B.length];
    const hAng = hNext.ang + (i + 1 >= H.length ? 2 * Math.PI : 0);
    const bAng = bNext.ang + (j + 1 >= B.length ? 2 * Math.PI : 0);
    if (i < H.length && (j >= B.length || hAng <= bAng)) {
      tri(out, map(h.p[0], h.p[1]), map(b.p[0], b.p[1]), map(hNext.p[0], hNext.p[1]), hint, color);
      i++;
    } else {
      tri(out, map(h.p[0], h.p[1]), map(b.p[0], b.p[1]), map(bNext.p[0], bNext.p[1]), hint, color);
      j++;
    }
  }
};

/** The arch opening's outline in a wall's (t across, y up) frame, from the right foot over the crown. */
const archOutline = (floor: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let k = 0; k <= ARCH_SEGMENTS; k++) {
    const ang = ARCH_START + ((ARCH_END - ARCH_START) * k) / ARCH_SEGMENTS;
    pts.push([PIPE_RADIUS * Math.cos(ang), floor + PIPE_AXIS_LIFT + PIPE_RADIUS * Math.sin(ang)]);
  }
  return pts;
};

type WallKind = "plain" | "arch" | "door";

/** The lines a box's floor grid runs on (both axes, ascending): its edges, the channel's, the arch
 *  feet and a room's pool. Inside an arch opening only the channel's fall, and the pipe's profile
 *  shares them. */
const gridLines = (half: number, room: boolean): number[] => {
  const lines = [-half, half, -CHANNEL_HALF, CHANNEL_HALF, -ARCH_FOOT, ARCH_FOOT];
  if (room) lines.push(-poolHalf, poolHalf);
  return lines.sort((a, b) => a - b);
};

/** [t0, t1] cut at the lines strictly inside it: the t's of the wall pieces built on it. */
const cuts = (t0: number, t1: number, lines: readonly number[]): number[] => [t0, ...lines.filter((l) => l > t0 + 1e-9 && l < t1 - 1e-9), t1];

const archTs = (): number[] => {
  const ts: number[] = [];
  for (let k = 0; k <= ARCH_SEGMENTS; k++) ts.push(PIPE_RADIUS * Math.cos(ARCH_START + ((ARCH_END - ARCH_START) * k) / ARCH_SEGMENTS));
  return ts;
};

/** The t's a wall of `kind` puts on its top or bottom edge, ascending. The walls, the ceiling and the
 *  floor are all built on these, so no vertex of one meets another's edge between two of its vertices:
 *  the shader quantizes every vertex on its own, and such a T-junction opened a crack of up to a
 *  lattice step (DECISIONS.md "The sewer joins, closed"). */
const wallEdgeTs = (kind: WallKind, half: number, lines: readonly number[], edge: "top" | "bottom"): number[] => {
  const ts: number[] = [];
  if (kind === "plain") ts.push(...cuts(-half, half, lines));
  else if (kind === "door") {
    ts.push(...cuts(-half, -DOOR_WIDTH / 2, lines), ...cuts(DOOR_WIDTH / 2, half, lines));
    if (edge === "top") ts.push(...cuts(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, lines));
  } else {
    ts.push(...cuts(-half, -ARCH_FOOT, lines), ...cuts(ARCH_FOOT, half, lines));
    if (edge === "top") ts.push(...archTs());
  }
  return ts.sort((a, b) => a - b);
};

/** A wall's in-plane t on side `side` (SEWER_DIRS order) → the box's (u, v). */
const sideUV = (side: number, half: number, t: number): [number, number] => (side === 0 ? [half, t] : side === 1 ? [t, half] : side === 2 ? [-half, -t] : [-t, -half]);

/** A box's outline at its ceiling: every wall's top vertices, each once. */
const boxOutline = (half: number, kinds: readonly WallKind[], lines: readonly number[]): [number, number][] => {
  const seen = new Set<string>();
  const pts: [number, number][] = [];
  kinds.forEach((kind, side) => {
    for (const t of wallEdgeTs(kind, half, lines, "top")) {
      const uv = sideUV(side, half, t);
      const key = uv[0].toFixed(6) + "," + uv[1].toFixed(6);
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(uv);
    }
  });
  return pts;
};

/** A level polygon, star-shaped about `center`, as a fan from it. */
const fanFace = (out: SewerTriangles, f: Frame, pts: readonly [number, number][], center: [number, number], y: number, hint: P3, color: readonly [number, number, number]): void => {
  const ring = pts.map((p) => ({ ang: Math.atan2(p[1] - center[1], p[0] - center[0]), p })).sort((a, b) => a.ang - b.ang);
  const c = f.at(center[0], center[1], y);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k].p;
    const b = ring[(k + 1) % ring.length].p;
    tri(out, c, f.at(a[0], a[1], y), f.at(b[0], b[1], y), hint, color);
  }
};

interface Frame {
  /** Local (u, v, y) → world. */
  at: (u: number, v: number, y: number) => P3;
  ex: { x: number; z: number };
  ez: { x: number; z: number };
}

const frameOf = (layout: SewerLayout, cx: number, cz: number): Frame => {
  const { ex, ez } = districtAxes(layout.district);
  return { at: (u, v, y) => [cx + ex.x * u + ez.x * v, y, cz + ex.z * u + ez.z * v], ex, ez };
};

/** A box's wall on side `side` (SEWER_DIRS order): its in-plane coordinate `t` and the world point. */
const wallPoint = (f: Frame, half: number, side: number, t: number, y: number): P3 => {
  switch (side) {
    case 0:
      return f.at(half, t, y);
    case 1:
      return f.at(t, half, y);
    case 2:
      return f.at(-half, -t, y);
    default:
      return f.at(-t, -half, y);
  }
};

const inwardHint = (f: Frame, side: number): P3 => {
  const d = SEWER_DIRS[side];
  return [-(f.ex.x * d[0] + f.ez.x * d[1]), 0, -(f.ex.z * d[0] + f.ez.z * d[1])];
};

/** A wall rectangle [t0, t1] × [y0, y1] with no opening, cut at the floor grid's lines. */
const wallRect = (out: SewerTriangles, f: Frame, half: number, side: number, t0: number, t1: number, y0: number, y1: number, lines: readonly number[]): void => {
  if (y1 - y0 < 1e-6) return;
  const ts = cuts(t0, t1, lines);
  for (let k = 0; k + 1 < ts.length; k++) {
    if (ts[k + 1] - ts[k] < 1e-6) continue;
    quad(out, [wallPoint(f, half, side, ts[k], y0), wallPoint(f, half, side, ts[k + 1], y0), wallPoint(f, half, side, ts[k + 1], y1), wallPoint(f, half, side, ts[k], y1)], inwardHint(f, side), SEWER_WALL_COLOR);
  }
};

/** A wall with an arch opening: the pieces beside it and the strip above the arc. */
const wallWithArch = (out: SewerTriangles, f: Frame, half: number, side: number, floor: number, top: number, lines: readonly number[]): void => {
  wallRect(out, f, half, side, -half, -ARCH_FOOT, floor, top, lines);
  wallRect(out, f, half, side, ARCH_FOOT, half, floor, top, lines);
  const arc = archOutline(floor);
  const hint = inwardHint(f, side);
  for (let k = 0; k + 1 < arc.length; k++) {
    const a = arc[k];
    const b = arc[k + 1];
    quad(out, [wallPoint(f, half, side, a[0], a[1]), wallPoint(f, half, side, b[0], b[1]), wallPoint(f, half, side, b[0], top), wallPoint(f, half, side, a[0], top)], hint, SEWER_WALL_COLOR);
  }
};

/** A wall with a doorway (DOOR_WIDTH × DOOR_HEIGHT, centered). */
const wallWithDoorway = (out: SewerTriangles, f: Frame, half: number, side: number, floor: number, top: number, lines: readonly number[]): void => {
  wallRect(out, f, half, side, -half, -DOOR_WIDTH / 2, floor, top, lines);
  wallRect(out, f, half, side, DOOR_WIDTH / 2, half, floor, top, lines);
  wallRect(out, f, half, side, -DOOR_WIDTH / 2, DOOR_WIDTH / 2, floor + DOOR_HEIGHT, top, lines);
};

const wallKindsOf = (node: SewerNode): WallKind[] => [0, 1, 2, 3].map((side) => (node.links[side] ? "arch" : node.door === side ? "door" : "plain"));

/** A node box's floor: a grid cut at the channel and pool edges, each cell at its level, with a plumb
 *  face wherever two levels meet. */
const boxFloor = (out: SewerTriangles, f: Frame, node: SewerNode, kinds: readonly WallKind[], ls: readonly number[]): void => {
  const half = boxHalf(node);
  const F = node.floor;
  const anyLink = node.links.some((l) => l);
  const level = (uc: number, vc: number): number => {
    if (node.room && Math.abs(uc) < poolHalf && Math.abs(vc) < poolHalf) return F - POOL_DEPTH;
    if (Math.abs(uc) < CHANNEL_HALF && Math.abs(vc) < CHANNEL_HALF && anyLink) return F - CHANNEL_DEPTH;
    if (Math.abs(uc) < CHANNEL_HALF && ((vc > 0 && node.links[1]) || (vc < 0 && node.links[3]))) return F - CHANNEL_DEPTH;
    if (Math.abs(vc) < CHANNEL_HALF && ((uc > 0 && node.links[0]) || (uc < 0 && node.links[2]))) return F - CHANNEL_DEPTH;
    return F;
  };
  const colorOf = (lv: number): readonly [number, number, number] => (lv === F ? SEWER_WALKWAY_COLOR : SEWER_SLIME_COLOR);
  const n = ls.length - 1;
  const levels: number[][] = [];
  for (let a = 0; a < n; a++) {
    levels.push([]);
    for (let b = 0; b < n; b++) levels[a].push(level((ls[a] + ls[a + 1]) / 2, (ls[b] + ls[b + 1]) / 2));
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const lv = levels[a][b];
      // A cell on a doorway's wall shares the jambs' feet (the only wall vertices off the grid).
      const pts: [number, number][] = [[ls[a], ls[b]], [ls[a + 1], ls[b]], [ls[a + 1], ls[b + 1]], [ls[a], ls[b + 1]]];
      const edges: [number, boolean][] = [[0, a === n - 1], [1, b === n - 1], [2, a === 0], [3, b === 0]];
      for (const [side, onIt] of edges) {
        if (!onIt || kinds[side] !== "door") continue;
        for (const t of [-DOOR_WIDTH / 2, DOOR_WIDTH / 2]) {
          const uv = sideUV(side, half, t);
          const along = side % 2 === 0 ? uv[1] : uv[0];
          const lo = side % 2 === 0 ? ls[b] : ls[a];
          const hi = side % 2 === 0 ? ls[b + 1] : ls[a + 1];
          if (along > lo + 1e-9 && along < hi - 1e-9) pts.push(uv);
        }
      }
      fanFace(out, f, pts, [(ls[a] + ls[a + 1]) / 2, (ls[b] + ls[b + 1]) / 2], lv, [0, 1, 0], colorOf(lv));
      // Steps to the next cell along u and along v.
      if (a + 1 < n && levels[a + 1][b] !== lv) {
        const hi = Math.max(lv, levels[a + 1][b]);
        const lo = Math.min(lv, levels[a + 1][b]);
        const towardLower: P3 = lv < levels[a + 1][b] ? [-f.ex.x, 0, -f.ex.z] : [f.ex.x, 0, f.ex.z];
        quad(out, [f.at(ls[a + 1], ls[b], lo), f.at(ls[a + 1], ls[b + 1], lo), f.at(ls[a + 1], ls[b + 1], hi), f.at(ls[a + 1], ls[b], hi)], towardLower, SEWER_WALL_COLOR);
      }
      if (b + 1 < n && levels[a][b + 1] !== lv) {
        const hi = Math.max(lv, levels[a][b + 1]);
        const lo = Math.min(lv, levels[a][b + 1]);
        const towardLower: P3 = lv < levels[a][b + 1] ? [-f.ez.x, 0, -f.ez.z] : [f.ez.x, 0, f.ez.z];
        quad(out, [f.at(ls[a], ls[b + 1], lo), f.at(ls[a + 1], ls[b + 1], lo), f.at(ls[a + 1], ls[b + 1], hi), f.at(ls[a], ls[b + 1], hi)], towardLower, SEWER_WALL_COLOR);
      }
    }
  }
};

const shaftOutline = (cu: number, cv: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let k = 0; k < SHAFT_SIDES; k++) {
    const ang = (k * 2 * Math.PI) / SHAFT_SIDES;
    pts.push([cu + Math.cos(ang) * SHAFT_RADIUS, cv + Math.sin(ang) * SHAFT_RADIUS]);
  }
  return pts;
};

/** The shaft's wall from the box ceiling `top` to the street: SHAFT_SIDES faces, inward-facing, shaded
 *  round, on the SAME ring as the ceiling's hole (the box frame's `shaftOutline` at (cu, cv)): a ring
 *  laid in world axes stood rotated against the hole's by the district's angle, and the sky showed
 *  through the slivers between the two sixteen-gons. */
const shaftWall = (out: SewerTriangles, f: Frame, node: SewerNode, cu: number, cv: number, top: number): void => {
  const shaftTop = (node.manholeInfo ? node.manholeInfo.streetY : node.street) + SHAFT_ABOVE_STREET;
  const ring = shaftOutline(cu, cv);
  const normal = (ang: number): P3 => [-(f.ex.x * Math.cos(ang) + f.ez.x * Math.sin(ang)), 0, -(f.ex.z * Math.cos(ang) + f.ez.z * Math.sin(ang))];
  for (let k = 0; k < SHAFT_SIDES; k++) {
    const a0 = (k * 2 * Math.PI) / SHAFT_SIDES;
    const a1 = ((k + 1) * 2 * Math.PI) / SHAFT_SIDES;
    const r0 = ring[k];
    const r1 = ring[(k + 1) % SHAFT_SIDES];
    const n0 = normal(a0);
    const n1 = normal(a1);
    quad(out, [f.at(r0[0], r0[1], top), f.at(r1[0], r1[1], top), f.at(r1[0], r1[1], shaftTop), f.at(r0[0], r0[1], shaftTop)], [n0[0] + n1[0], 0, n0[2] + n1[2]], SEWER_WALL_COLOR, [n0, n1, n1, n0]);
  }
};

/** A node's box: its floor, its four walls (an arch where a street leaves, a doorway where its door is),
 *  its ceiling (around the shaft, with the shaft's wall, when it has a manhole) and its side room. */
const nodeBox = (out: SewerTriangles, layout: SewerLayout, node: SewerNode): void => {
  const f = frameOf(layout, node.x, node.z);
  const half = boxHalf(node);
  const F = node.floor;
  const top = F + boxHeight(node);
  const kinds = wallKindsOf(node);
  const lines = gridLines(half, node.room);
  boxFloor(out, f, node, kinds, lines);
  for (let side = 0; side < 4; side++) {
    if (kinds[side] === "arch") wallWithArch(out, f, half, side, F, top, lines);
    else if (kinds[side] === "door") wallWithDoorway(out, f, half, side, F, top, lines);
    else wallRect(out, f, half, side, -half, half, F, top, lines);
  }
  const outline = boxOutline(half, kinds, lines);
  if (node.manhole) {
    const [sx, sz] = node.manholeCorner;
    const off = half - SHAFT_CORNER_IN;
    fillAroundHole(out, outline, shaftOutline(sx * off, sz * off), [sx * off, sz * off], (u, v) => f.at(u, v, top), [0, -1, 0], SEWER_WALL_COLOR);
    shaftWall(out, f, node, sx * off, sz * off, top);
  } else {
    fanFace(out, f, outline, [0, 0], top, [0, -1, 0], SEWER_WALL_COLOR);
  }
  if (node.door >= 0) sideRoom(out, layout, node, node.door);
};

/** The doorway's reveal and the side room behind it. */
const sideRoom = (out: SewerTriangles, layout: SewerLayout, node: SewerNode, side: number): void => {
  const sr = sideRoomOf(layout.district, node, side);
  const F = node.floor;
  const half = boxHalf(node);
  const f = frameOf(layout, node.x, node.z);
  // The reveal in the box's frame: from the wall plane (half) out to half + REVEAL_DEPTH, across ±DOOR_WIDTH/2.
  const far = half + REVEAL_DEPTH;
  const rp = (across: number, outward: number, y: number): P3 => {
    const d = SEWER_DIRS[side];
    const u = d[0] !== 0 ? outward * d[0] : across;
    const v = d[1] !== 0 ? outward * d[1] : across;
    return f.at(u, v, y);
  };
  const w = DOOR_WIDTH / 2;
  const acrossAxis: P3 = side % 2 === 0 ? [f.ez.x, 0, f.ez.z] : [f.ex.x, 0, f.ex.z];
  quad(out, [rp(-w, half, F), rp(w, half, F), rp(w, far, F), rp(-w, far, F)], [0, 1, 0], SEWER_WALKWAY_COLOR);
  quad(out, [rp(-w, half, F + DOOR_HEIGHT), rp(w, half, F + DOOR_HEIGHT), rp(w, far, F + DOOR_HEIGHT), rp(-w, far, F + DOOR_HEIGHT)], [0, -1, 0], SEWER_WALL_COLOR);
  quad(out, [rp(-w, half, F), rp(-w, far, F), rp(-w, far, F + DOOR_HEIGHT), rp(-w, half, F + DOOR_HEIGHT)], acrossAxis, SEWER_WALL_COLOR);
  quad(out, [rp(w, half, F), rp(w, far, F), rp(w, far, F + DOOR_HEIGHT), rp(w, half, F + DOOR_HEIGHT)], [-acrossAxis[0], 0, -acrossAxis[2]], SEWER_WALL_COLOR);
  // The side room: its own frame, the near wall (toward the box) holding the doorway.
  const g = frameOf(layout, sr.cx, sr.cz);
  const h = SIDE_ROOM_HALF;
  const top = F + SIDE_ROOM_HEIGHT;
  const near = (side + 2) % 4;
  const outline = boxOutline(h, [0, 1, 2, 3].map((s): WallKind => (s === near ? "door" : "plain")), []);
  fanFace(out, g, outline, [0, 0], F, [0, 1, 0], SEWER_WALKWAY_COLOR);
  fanFace(out, g, outline, [0, 0], top, [0, -1, 0], SEWER_WALL_COLOR);
  for (let s = 0; s < 4; s++) {
    if (s === near) wallWithDoorway(out, g, h, s, F, top, []);
    else wallRect(out, g, h, s, -h, h, F, top, []);
  }
};

/** The pipe profile's segments in the cross-section (lateral, height over the floor), each with its
 *  color and whether it is shaded smooth (the arch). */
interface ProfileSegment {
  l0: number;
  h0: number;
  l1: number;
  h1: number;
  color: readonly [number, number, number];
  arch: boolean;
}

const PIPE_PROFILE: ProfileSegment[] = (() => {
  const segs: ProfileSegment[] = [];
  segs.push({ l0: -ARCH_FOOT, h0: 0, l1: -CHANNEL_HALF, h1: 0, color: SEWER_WALKWAY_COLOR, arch: false });
  segs.push({ l0: -CHANNEL_HALF, h0: 0, l1: -CHANNEL_HALF, h1: -CHANNEL_DEPTH, color: SEWER_WALL_COLOR, arch: false });
  segs.push({ l0: -CHANNEL_HALF, h0: -CHANNEL_DEPTH, l1: CHANNEL_HALF, h1: -CHANNEL_DEPTH, color: SEWER_SLIME_COLOR, arch: false });
  segs.push({ l0: CHANNEL_HALF, h0: -CHANNEL_DEPTH, l1: CHANNEL_HALF, h1: 0, color: SEWER_WALL_COLOR, arch: false });
  segs.push({ l0: CHANNEL_HALF, h0: 0, l1: ARCH_FOOT, h1: 0, color: SEWER_WALKWAY_COLOR, arch: false });
  for (let k = 0; k < ARCH_SEGMENTS; k++) {
    const a0 = ARCH_START + ((ARCH_END - ARCH_START) * k) / ARCH_SEGMENTS;
    const a1 = ARCH_START + ((ARCH_END - ARCH_START) * (k + 1)) / ARCH_SEGMENTS;
    segs.push({ l0: PIPE_RADIUS * Math.cos(a0), h0: PIPE_AXIS_LIFT + PIPE_RADIUS * Math.sin(a0), l1: PIPE_RADIUS * Math.cos(a1), h1: PIPE_AXIS_LIFT + PIPE_RADIUS * Math.sin(a1), color: SEWER_WALL_COLOR, arch: true });
  }
  return segs;
})();

/** The pipe profile extruded wall to wall in PIPE_SLICE slices, each face wound toward the axis. */
const pipe = (out: SewerTriangles, a: SewerNode, b: SewerNode): void => {
  const { pipe: piece, length: len, dx, dz, sideX: sx, sideZ: sz } = streetFrameOf(a, b);
  const from = boxHalf(a);
  const to = len - boxHalf(b);
  const slices = Math.max(1, Math.ceil((to - from) / PIPE_SLICE));
  const at = (s: number, l: number, h: number): P3 => {
    const F = pipeFloorAt(piece, s, len);
    return [a.x + dx * s + sx * l, F + h, a.z + dz * s + sz * l];
  };
  for (let k = 0; k < slices; k++) {
    const s0 = from + ((to - from) * k) / slices;
    const s1 = from + ((to - from) * (k + 1)) / slices;
    for (const seg of PIPE_PROFILE) {
      const c: P3[] = [at(s0, seg.l0, seg.h0), at(s1, seg.l0, seg.h0), at(s1, seg.l1, seg.h1), at(s0, seg.l1, seg.h1)];
      // The air lies toward the axis (0, PIPE_AXIS_LIFT) from the segment's middle.
      const ml = (seg.l0 + seg.l1) / 2;
      const mh = (seg.h0 + seg.h1) / 2;
      const hint: P3 = [sx * -ml, PIPE_AXIS_LIFT - mh, sz * -ml];
      if (seg.arch) {
        const n = (l: number, h: number): P3 => {
          const rl = -l;
          const rh = PIPE_AXIS_LIFT - h;
          const m = Math.hypot(rl, rh) || 1;
          return [(sx * rl) / m, rh / m, (sz * rl) / m];
        };
        quad(out, c, hint, seg.color, [n(seg.l0, seg.h0), n(seg.l0, seg.h0), n(seg.l1, seg.h1), n(seg.l1, seg.h1)]);
      } else quad(out, c, hint, seg.color);
    }
  }
};

export const buildSewerTriangles = (layout: SewerLayout): SewerTriangles => {
  const out: SewerTriangles = { positions: [], normals: [], colors: [] };
  for (const node of layout.nodes.values()) nodeBox(out, layout, node);
  for (const s of layout.streets) pipe(out, layout.nodes.get(s.a)!, layout.nodes.get(s.b)!);
  return out;
};

/** A border cap's pipe section grows this much about the pipe's axis, and a box's rectangle this far
 *  past its chord and floor and ceiling: into the rock, behind the walls, so the clipped slices' edge
 *  on the border (between two profile rings, on a sloping floor) never shows past it. */
const CAP_GROW = 1.15;
const CAP_MARGIN = 0.5;

export type PlaneAxis = "x" | "z";

/** Every piece of a layout's air the vertical plane x = `at` (axis "x") or z = `at` (axis "z") cuts
 *  within [lo, hi) along it, as polygons IN the plane (absolute): a pipe's oblique section where the
 *  plane crosses it, and a rectangle over the chord of every node box (with its shaft, up to the street)
 *  and side room it crosses. What a chunk caps on its border. */
export const sewerPlaneSections = (layout: SewerLayout, axis: PlaneAxis, at: number, lo: number, hi: number): P3[][] => {
  const out: P3[][] = [];
  const nx = axis === "x" ? 1 : 0;
  const nz = axis === "x" ? 0 : 1;
  const inPlane = (t: number, y: number): P3 => (axis === "x" ? [at, y, t] : [t, y, at]);
  for (const s of layout.streets) {
    const a = layout.nodes.get(s.a)!;
    const b = layout.nodes.get(s.b)!;
    const { pipe: piece, length: len, dx, dz, sideX: sx, sideZ: sz } = streetFrameOf(a, b);
    const dn = dx * nx + dz * nz;
    if (Math.abs(dn) < 1e-6) continue;
    const sn = sx * nx + sz * nz;
    const s0 = (at - (a.x * nx + a.z * nz)) / dn;
    if (s0 < boxHalf(a) || s0 > len - boxHalf(b)) continue;
    const t = axis === "x" ? a.z + dz * s0 : a.x + dx * s0;
    if (t < lo || t >= hi) continue;
    const polygon: P3[] = [];
    for (const seg of PIPE_PROFILE) {
      const l = seg.l0 * CAP_GROW;
      const h = PIPE_AXIS_LIFT + (seg.h0 - PIPE_AXIS_LIFT) * CAP_GROW;
      // The profile point at lateral l lies in the plane at this distance along the street.
      const sl = s0 - (l * sn) / dn;
      polygon.push([a.x + dx * sl + sx * l, pipeFloorAt(piece, sl, len) + h, a.z + dz * sl + sz * l]);
    }
    out.push(polygon);
  }
  const { ex, ez } = districtAxes(layout.district);
  /** The plane's run through a box of `half` about (cx, cz) in the district's axes: [t0, t1] or null. */
  const chord = (cx: number, cz: number, half: number): [number, number] | null => {
    let t0 = lo;
    let t1 = hi;
    for (const e of [ex, ez]) {
      const alpha = axis === "x" ? (at - cx) * e.x - cz * e.z : -cx * e.x + (at - cz) * e.z;
      const beta = axis === "x" ? e.z : e.x;
      if (Math.abs(beta) < 1e-9) {
        if (Math.abs(alpha) > half) return null;
        continue;
      }
      const r0 = (-half - alpha) / beta;
      const r1 = (half - alpha) / beta;
      t0 = Math.max(t0, Math.min(r0, r1));
      t1 = Math.min(t1, Math.max(r0, r1));
    }
    return t1 > t0 ? [t0, t1] : null;
  };
  const rect = (cx: number, cz: number, half: number, yLow: number, yTop: number): void => {
    const c = chord(cx, cz, half);
    if (!c) return;
    out.push([inPlane(c[0] - CAP_MARGIN, yLow), inPlane(c[1] + CAP_MARGIN, yLow), inPlane(c[1] + CAP_MARGIN, yTop), inPlane(c[0] - CAP_MARGIN, yTop)]);
  };
  for (const node of layout.nodes.values()) {
    const shaft = node.manhole && node.manholeInfo;
    rect(node.x, node.z, boxHalf(node) + (shaft ? SHAFT_RADIUS : 0), node.floor - (node.room ? POOL_DEPTH : CHANNEL_DEPTH) - CAP_MARGIN, shaft ? node.manholeInfo!.streetY : node.floor + boxHeight(node) + CAP_MARGIN);
    if (node.door < 0) continue;
    const sr = sideRoomOf(layout.district, node, node.door);
    rect(sr.cx, sr.cz, SIDE_ROOM_HALF + REVEAL_DEPTH, node.floor - CAP_MARGIN, node.floor + Math.max(...SIDE_ROOM_HEIGHTS) + SIDE_ROOM_HEIGHT + CAP_MARGIN);
  }
  return out;
};

export interface LiquidQuads {
  /** Four corners per quad, absolute. */
  quads: P3[][];
}

/** The liquid surface: a strip along each channel (node middle to node middle, overrun past both
 *  ends, stopping at a room's pool) and a pool per room (a fan sharing the strips' end points),
 *  LIQUID_BELOW_WALKWAY under the walkways. Triangles and quads alike: the chunk clip fans each. */
export const buildSewerLiquid = (layout: SewerLayout): LiquidQuads => {
  const quads: P3[][] = [];
  // On the lattice like the walls: a strip's end meets the pool's edge, and the two reach the same
  // points through different arithmetic.
  const sp = (p: P3): P3 => [snap(p[0]), snap(p[1]), snap(p[2])];
  for (const node of layout.nodes.values()) {
    if (!node.room) continue;
    const f = frameOf(layout, node.x, node.z);
    const y = node.floor - LIQUID_BELOW_WALKWAY;
    // The pool as a fan over its outline WITH each entering strip's two end points on its edge: a
    // plain quad left them mid-edge, and the per-vertex quantization opened a line along the join.
    const outline: [number, number][] = [[-poolHalf, -poolHalf], [poolHalf, -poolHalf], [poolHalf, poolHalf], [-poolHalf, poolHalf]];
    node.links.forEach((linked, side) => {
      if (linked) for (const t of [-CHANNEL_HALF, CHANNEL_HALF]) outline.push(sideUV(side, poolHalf, t));
    });
    const ring = outline.map((p) => ({ ang: Math.atan2(p[1], p[0]), p })).sort((u, v) => u.ang - v.ang);
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k].p;
      const q = ring[(k + 1) % ring.length].p;
      quads.push([sp(f.at(0, 0, y)), sp(f.at(p[0], p[1], y)), sp(f.at(q[0], q[1], y))]);
    }
  }
  for (const s of layout.streets) {
    const a = layout.nodes.get(s.a)!;
    const b = layout.nodes.get(s.b)!;
    const { pipe: piece, length: len, dx, dz, sideX: sx, sideZ: sz } = streetFrameOf(a, b);
    const from = a.room ? poolHalf : -CHANNEL_OVERRUN;
    const to = len - (b.room ? poolHalf : -CHANNEL_OVERRUN);
    const slices = Math.max(1, Math.ceil((to - from) / PIPE_SLICE));
    const at = (sAlong: number, l: number): P3 => sp([a.x + dx * sAlong + sx * l, pipeFloorAt(piece, sAlong, len) - LIQUID_BELOW_WALKWAY, a.z + dz * sAlong + sz * l]);
    for (let k = 0; k < slices; k++) {
      const s0 = from + ((to - from) * k) / slices;
      const s1 = from + ((to - from) * (k + 1)) / slices;
      quads.push([at(s0, -CHANNEL_HALF), at(s1, -CHANNEL_HALF), at(s1, CHANNEL_HALF), at(s0, CHANNEL_HALF)]);
    }
  }
  return { quads };
};

/** The liquid level at a point (relative to the chunk's center, like the liquid's positions) from a
 *  chunk's liquid triangles: the first triangle holding the point, by barycentric weights; NaN when none. */
export const liquidLevelOf = (liquid: { positions: Float32Array; indices: Uint32Array }, lx: number, lz: number): number => {
  const pos = liquid.positions;
  const idx = liquid.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const d = idx[t + 2] * 3;
    const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[d], cz = pos[d + 2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    const wa = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / den;
    const wb = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / den;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    return pos[a + 1] * wa + pos[b + 1] * wb + pos[d + 1] * wc;
  }
  return NaN;
};

const geometryCache = new Map<string, { triangles: SewerTriangles; liquid: LiquidQuads }>();
const GEOMETRY_CACHE_MAX = 16;

export const clearSewerGeometry = (): void => geometryCache.clear();

/** A merged layout's geometry, built once (every chunk of the district takes its own triangles). */
export const sewerGeometryOf = (layout: SewerLayout): { triangles: SewerTriangles; liquid: LiquidQuads } => {
  let g = geometryCache.get(layout.key);
  if (!g) {
    if (geometryCache.size >= GEOMETRY_CACHE_MAX) dropOldestHalf(geometryCache);
    g = { triangles: buildSewerTriangles(layout), liquid: buildSewerLiquid(layout) };
    geometryCache.set(layout.key, g);
  }
  return g;
};
