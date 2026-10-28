/**
 * THE tunnels' air as one signed field, negative in the air: pieces of one path union plainly, paths
 * of one system meet in a smooth junction, formations are subtracted (rock), separate systems simply
 * overlap. A function of the point alone — a piece counts only inside its bounds padded by FIELD_REACH
 * (else as that far) and the wall noise only within NOISE_SHELL of a wall — so every brick, chunk and
 * thread reads the same bits from whatever subset of pieces holds the air. Three-free.
 */

import Noise from "noise-ts";
import { seedRand } from "../../math";
import type { RectXZ } from "../../math/types";
import {
  AXIS_LIFT,
  CHANNEL_DEPTH,
  CHANNEL_HALF,
  CHANNEL_OVERRUN,
  FIELD_REACH,
  FLOOR_BUMP,
  FOOTPRINT_PAD,
  JUNCTION_BLEND,
  MOUTH_HOLE_CAP_PAD,
  MOUTH_HOLE_CAP_RADII,
  MOUTH_RIM_AMP,
  NOISE_SHELL,
  PIPE_AXIS_LIFT,
  PIPE_RADIUS,
  SECTION_FULL_SHARE,
  SHAFT_ABOVE_STREET,
  SHAFT_CLOSED_BELOW_STREET,
  WALL_BULGE,
  TUBE_CAP_FLOOR_RISE,
} from "./constants";
import type { Bounds3, BoxPiece, ConePiece, MouthPiece, PipePiece, RoomPiece, ShaftPiece, TubePiece, TunnelPiece } from "./types";

export type FieldFn = (x: number, y: number, z: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

const noise = new Noise(seedRand("tunnel walls"));

// Both noises are functions of the point alone, and one field evaluation asks several pieces (every
// consecutive tube of a path reaches most samples near it) at the SAME point: the last point's value is
// kept, keyed on the exact coordinates, so a sample pays each noise once (simplex3 was 18% of a cave
// chunk; DECISIONS.md).
let wallAtX = NaN;
let wallAtY = NaN;
let wallAtZ = NaN;
let wallValue = 0;
let bumpAtX = NaN;
let bumpAtZ = NaN;
let bumpValue = 0;

/** Wall noise in [−1, 1]: big lumps (~13u) plus a little grain (~3.3u). */
export const wallNoise = (x: number, y: number, z: number): number => {
  if (x === wallAtX && y === wallAtY && z === wallAtZ) return wallValue;
  wallAtX = x;
  wallAtY = y;
  wallAtZ = z;
  return (wallValue = 0.78 * noise.simplex3(x / 13, y / 13, z / 13) + 0.22 * noise.simplex3(x / 3.3, y / 3.3, z / 3.3));
};

/** Floor bumps in [0, 1] (they only ever raise the floor). */
const bumpNoise = (x: number, z: number): number => {
  if (x === bumpAtX && z === bumpAtZ) return bumpValue;
  bumpAtX = x;
  bumpAtZ = z;
  return (bumpValue = 0.5 + 0.5 * noise.simplex3(x / 5.5, 17.3, z / 5.5));
};

/** The ragged outline of a mouth: four sines of the angle about the axis and the distance along it,
 *  in [−1, 1]. */
const mouthRimNoise = (theta: number, along: number, phase: number): number =>
  0.25 *
  (Math.sin(3 * theta + phase) +
    Math.sin(5 * theta - 2 * phase + 0.4 * along) +
    Math.sin(2 * theta + 0.7 * along + 1.7 * phase) +
    Math.sin(7 * theta - 0.3 * along + 0.6 * phase));

/** Polynomial smooth minimum: never lower than min(a, b) − k/4. */
export const smoothMin = (a: number, b: number, k: number): number => {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
};

// ── Mouth geometry ─────────────────────────────────────────────────────────

export const mouthRadiusAt = (m: MouthPiece, along: number): number => {
  const full = m.length * SECTION_FULL_SHARE;
  if (along <= full) return m.r0;
  if (along >= m.length) return m.r1;
  return m.r0 + ((m.r1 - m.r0) * (along - full)) / (m.length - full);
};

/** The section's floor: the opening's, descending at the grade into the mountain. */
export const mouthFloorAt = (m: MouthPiece, along: number): number => m.oy - m.grade * (along < 0 ? 0 : along > m.length ? m.length : along);

/** (along, lateral) of a world point in the mouth's frame: along from the opening into the mountain. */
export const mouthAlong = (m: MouthPiece, x: number, z: number): number => (x - m.ox) * m.dx + (z - m.oz) * m.dz;
export const mouthLateral = (m: MouthPiece, x: number, z: number): number => -(x - m.ox) * m.dz + (z - m.oz) * m.dx;

/** Horizontal distance from a point to the section's segment (opening → inner end). */
export const mouthSectionDistance = (m: MouthPiece, x: number, z: number): number => {
  let a = mouthAlong(m, x, z);
  if (a < 0) a = 0;
  else if (a > m.length) a = m.length;
  const px = m.ox + m.dx * a;
  const pz = m.oz + m.dz * a;
  return Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
};

/** Horizontal distance from a rectangle to the section (0 when the section crosses it): the section's
 *  distance from the opening's point clamped into the rectangle. */
export const mouthSectionDistanceToRect = (m: MouthPiece, rect: RectXZ): number =>
  mouthSectionDistance(m, Math.max(rect.minX, Math.min(rect.maxX, m.ox)), Math.max(rect.minZ, Math.min(rect.maxZ, m.oz)));

/** The footprint: the capsule along the section FOOTPRINT_PAD wider than the widest outline. */
export const mouthFootprintRadius = (m: MouthPiece): number => m.width + FOOTPRINT_PAD;
export const insideMouthFootprint = (m: MouthPiece, x: number, z: number, inset = 0): boolean =>
  mouthSectionDistance(m, x, z) < mouthFootprintRadius(m) - inset;

/** The ceiling of a mouth's terrain CUT over its section's floor: the terrain discards under it inside the
 *  footprint (world/shaders/terrainHoles.ts mouthCutsHere), so the mountain above the opening stays. */
export const mouthCutCeiling = (m: MouthPiece): number => m.r0 * MOUTH_HOLE_CAP_RADII + MOUTH_HOLE_CAP_PAD;

/** Whether a point is in a mouth's cut: in its footprint, under the cut's ceiling over the section's floor
 *  there. The entrance PATCH draws the ground and walls there, and is their collider: a body's step leaves
 *  the terrain heightfield out inside it (physics/tunnelRules.ts), which draws nothing there. */
export const insideMouthCut = (m: MouthPiece, x: number, y: number, z: number): boolean => {
  if (!insideMouthFootprint(m, x, z)) return false;
  const a = Math.max(0, Math.min(m.length, mouthAlong(m, x, z)));
  return y < m.oy - m.grade * a + mouthCutCeiling(m);
};

/** The horizontal extents of a footprint. */
export const mouthFootprintBounds = (m: MouthPiece): RectXZ => {
  const r = mouthFootprintRadius(m);
  const ix = m.ox + m.dx * m.length;
  const iz = m.oz + m.dz * m.length;
  return { minX: Math.min(m.ox, ix) - r, maxX: Math.max(m.ox, ix) + r, minZ: Math.min(m.oz, iz) - r, maxZ: Math.max(m.oz, iz) + r };
};

// ── Bounds ────────────────────────────────────────────────────────────────

export const emptyBounds = (): Bounds3 => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });

export const growBounds = (b: Bounds3, o: Bounds3): void => {
  if (o.minX < b.minX) b.minX = o.minX;
  if (o.minY < b.minY) b.minY = o.minY;
  if (o.minZ < b.minZ) b.minZ = o.minZ;
  if (o.maxX > b.maxX) b.maxX = o.maxX;
  if (o.maxY > b.maxY) b.maxY = o.maxY;
  if (o.maxZ > b.maxZ) b.maxZ = o.maxZ;
};

const boundsTouch = (a: Bounds3, b: Bounds3, pad = 0): boolean =>
  a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;

export const boundsTouchXZ = (a: Bounds3, minX: number, minZ: number, maxX: number, maxZ: number, pad = 0): boolean =>
  a.minX - pad <= maxX && a.maxX + pad >= minX && a.minZ - pad <= maxZ && a.maxZ + pad >= minZ;

const segmentBounds = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): Bounds3 => ({
  minX: Math.min(ax, bx) - r,
  minY: Math.min(ay, by) - r,
  minZ: Math.min(az, bz) - r,
  maxX: Math.max(ax, bx) + r,
  maxY: Math.max(ay, by) + r,
  maxZ: Math.max(az, bz) + r,
});

/** A piece before its bounds are computed (Omit distributed over the union). */
type Unbounded<T> = T extends unknown ? Omit<T, "bounds"> : never;
export type PieceInput = Unbounded<TunnelPiece>;

/** The extents of a piece's AIR (a cone: its rock). */
export const pieceBounds = (p: PieceInput): Bounds3 => {
  switch (p.kind) {
    case "tube": {
      const r = Math.max(p.ra * (1 + p.bulgeA), p.rb * (1 + p.bulgeB)) + FLOOR_BUMP;
      return segmentBounds(p.ax, p.ay + AXIS_LIFT * p.ra, p.az, p.bx, p.by + AXIS_LIFT * p.rb, p.bz, r);
    }
    case "mouth": {
      const r = p.width + FLOOR_BUMP;
      return segmentBounds(p.ox, p.oy + AXIS_LIFT * p.r0, p.oz, p.ox + p.dx * p.length, p.oy - p.grade * p.length + AXIS_LIFT * p.r1, p.oz + p.dz * p.length, r);
    }
    case "room":
      // The wall bulges by half WALL_BULGE of the radius (roomField): bounded at the plain radius, a
      // brick the bulge reached was skipped as out of the air's reach — square holes in a pool room's wall.
      return segmentBounds(p.ax, p.ay + AXIS_LIFT * p.radius, p.az, p.bx, p.by + AXIS_LIFT * p.radius, p.bz, p.radius * (1 + WALL_BULGE * 0.5) + FLOOR_BUMP);
    case "cone": {
      const tip = p.y + p.dir * p.length;
      return { minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius, minY: Math.min(p.y, tip), maxY: Math.max(p.y, tip) };
    }
    case "box": {
      const ex = Math.abs(p.halfX * p.cos) + Math.abs(p.halfZ * p.sin);
      const ez = Math.abs(p.halfX * p.sin) + Math.abs(p.halfZ * p.cos);
      return { minX: p.cx - ex, maxX: p.cx + ex, minZ: p.cz - ez, maxZ: p.cz + ez, minY: p.floor, maxY: p.floor + p.height };
    }
    case "pipe": {
      const r = PIPE_RADIUS + CHANNEL_OVERRUN;
      const lo = Math.min(p.floorA, p.floorB) - CHANNEL_DEPTH;
      const hi = Math.max(p.floorA, p.floorB) + PIPE_AXIS_LIFT + PIPE_RADIUS;
      return { minX: Math.min(p.ax, p.bx) - r, maxX: Math.max(p.ax, p.bx) + r, minZ: Math.min(p.az, p.bz) - r, maxZ: Math.max(p.az, p.bz) + r, minY: lo, maxY: hi };
    }
    case "shaft":
      return { minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius, minY: p.bottom, maxY: p.street + SHAFT_ABOVE_STREET };
  }
};

export const withBounds = <P extends PieceInput>(p: P): P & { bounds: Bounds3 } => ({ ...p, bounds: pieceBounds(p) });

// ── Per-piece fields ──────────────────────────────────────────────────────

const tubeField = (p: TubePiece): FieldFn => {
  const ayAxis = p.ay + AXIS_LIFT * p.ra;
  const byAxis = p.by + AXIS_LIFT * p.rb;
  const dx = p.bx - p.ax;
  const dy = byAxis - ayAxis;
  const dz = p.bz - p.az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const len = Math.sqrt(l2);
  const { ax, az, ay, by, ra, rb, bulgeA, bulgeB, bumpA, bumpB } = p;
  return (x, y, z) => {
    let t = ((x - ax) * dx + (y - ayAxis) * dy + (z - az) * dz) / l2;
    // How far past an end, into the round cap (TUBE_CAP_FLOOR_RISE).
    const past = t < 0 ? -t * len : t > 1 ? (t - 1) * len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const r = ra + (rb - ra) * t;
    const px = x - (ax + dx * t);
    const py = y - (ayAxis + dy * t);
    const pz = z - (az + dz * t);
    let d = Math.sqrt(px * px + py * py + pz * pz) - r;
    if (d > -NOISE_SHELL && d < NOISE_SHELL) {
      const bulge = (bulgeA + (bulgeB - bulgeA) * t) * r;
      if (bulge > 0) d += bulge * wallNoise(x, y, z);
    }
    let floor = ay + (by - ay) * t + past * TUBE_CAP_FLOOR_RISE;
    const over = y - floor;
    if (over > -NOISE_SHELL && over < NOISE_SHELL) {
      const bump = bumpA + (bumpB - bumpA) * t;
      if (bump > 0) floor += bump * bumpNoise(x, z);
    }
    const cut = floor - y;
    return cut > d ? cut : d;
  };
};

const mouthField = (m: MouthPiece): FieldFn => {
  const { ox, oy, oz, dx, dz, length, grade, phase } = m;
  const full = length * SECTION_FULL_SHARE;
  const r0 = m.r0;
  const r1 = m.r1;
  return (x, y, z) => {
    const rx = x - ox;
    const rz = z - oz;
    const a = rx * dx + rz * dz;
    const l = -rx * dz + rz * dx;
    const ac = a < 0 ? 0 : a > length ? length : a;
    const r = ac <= full ? r0 : r0 + ((r1 - r0) * (ac - full)) / (length - full);
    const floor = oy - grade * ac;
    const axisY = floor + AXIS_LIFT * r;
    const h = y - axisY;
    const radial = Math.sqrt(l * l + h * h);
    let ragged = 1;
    if (a < length) {
      const fade = a < 0 ? 1 : 1 - a / length;
      ragged += MOUTH_RIM_AMP * fade * mouthRimNoise(Math.atan2(h, l), a, phase);
    }
    let d = radial - r * ragged;
    if (a < 0) d = d > -a ? d : -a;
    else if (a > length) d = d > a - length ? d : a - length;
    const cut = floor - y;
    return cut > d ? cut : d;
  };
};

/** Whether a point stands IN FRONT of a mouth's opening: past its opening plane (outside the section, where
 *  the field closes the mouth with rock) yet within the opening's outline carried outward and over its sill.
 *  That rock is fictitious — it is the open air over the ground before the opening — so the player's rock
 *  backstops must not push out of it: they pushed a player stepping out of a mouth back in, every frame
 *  (Evan, the cave at (-3604, -17706); MEASURED in the page). */
export const inFrontOfMouthOpening = (m: MouthPiece, x: number, y: number, z: number): boolean => {
  const rx = x - m.ox;
  const rz = z - m.oz;
  const a = rx * m.dx + rz * m.dz;
  if (a >= 0 || y < m.oy) return false;
  const l = -rx * m.dz + rz * m.dx;
  const h = y - (m.oy + AXIS_LIFT * m.r0);
  const ragged = 1 + MOUTH_RIM_AMP * mouthRimNoise(Math.atan2(h, l), a, m.phase);
  return Math.sqrt(l * l + h * h) < m.r0 * ragged;
};

const mouthFields = new WeakMap<MouthPiece, FieldFn>();

/** Whether a point (the ground, for the rim rocks) lies in the mouth's air: inside its ragged opening. */
export const insideMouthOpening = (m: MouthPiece, x: number, y: number, z: number): boolean => {
  let f = mouthFields.get(m);
  if (!f) mouthFields.set(m, (f = mouthField(m)));
  return f(x, y, z) < 0;
};

const roomField = (p: RoomPiece): FieldFn => {
  const R = p.radius;
  const ayAxis = p.ay + AXIS_LIFT * R;
  const byAxis = p.by + AXIS_LIFT * R;
  const dx = p.bx - p.ax;
  const dy = byAxis - ayAxis;
  const dz = p.bz - p.az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const { ax, az, ay, by } = p;
  return (x, y, z) => {
    let t = ((x - ax) * dx + (y - ayAxis) * dy + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - (ax + dx * t);
    const py = y - (ayAxis + dy * t);
    const pz = z - (az + dz * t);
    let d = Math.sqrt(px * px + py * py + pz * pz) - R;
    if (d > -NOISE_SHELL && d < NOISE_SHELL) d += WALL_BULGE * 0.5 * R * wallNoise(x, y, z);
    let floor = ay + (by - ay) * t;
    const over = y - floor;
    if (over > -NOISE_SHELL && over < NOISE_SHELL) floor += FLOOR_BUMP * bumpNoise(x, z);
    const cut = floor - y;
    return cut > d ? cut : d;
  };
};

/** A cone's distance (approximate outside its base): negative inside the rock it adds. */
const coneField = (c: ConePiece): FieldFn => {
  const { x: cx, y: cy, z: cz, length, radius, dir } = c;
  return (x, y, z) => {
    const along = (y - cy) * dir;
    const t = along / length;
    const r = radius * (1 - (t < 0 ? 0 : t > 1 ? 1 : t));
    const px = x - cx;
    const pz = z - cz;
    let d = Math.sqrt(px * px + pz * pz) - r;
    if (along < 0) d = d > -along ? d : -along;
    else if (along > length) d = d > along - length ? d : along - length;
    return d;
  };
};

const boxField = (p: BoxPiece): FieldFn => {
  const { cx, cz, floor, height, halfX, halfZ, cos, sin } = p;
  const top = floor + height;
  return (x, y, z) => {
    const rx = x - cx;
    const rz = z - cz;
    const lx = rx * cos + rz * sin;
    const lz = -rx * sin + rz * cos;
    let d = Math.abs(lx) - halfX;
    const d2 = Math.abs(lz) - halfZ;
    if (d2 > d) d = d2;
    const d3 = floor - y;
    if (d3 > d) d = d3;
    const d4 = y - top;
    return d4 > d ? d4 : d;
  };
};

/** The walkways of a pipe: their levels at each end and how far from each end they run flat. */
export type PipeWalkway = Pick<PipePiece, "floorA" | "floorB" | "flatA" | "flatB">;

/** The pipe's walkway level at `along` (flat over each box, sloping between the walls). */
export const pipeFloorAt = (p: PipeWalkway, along: number, length: number): number => {
  if (along <= p.flatA) return p.floorA;
  if (along >= length - p.flatB) return p.floorB;
  const t = (along - p.flatA) / (length - p.flatA - p.flatB);
  return p.floorA + (p.floorB - p.floorA) * t;
};

const pipeField = (p: PipePiece): FieldFn => {
  const len = Math.sqrt((p.bx - p.ax) ** 2 + (p.bz - p.az) ** 2);
  const dx = (p.bx - p.ax) / len;
  const dz = (p.bz - p.az) / len;
  const { ax, az } = p;
  return (x, y, z) => {
    const rx = x - ax;
    const rz = z - az;
    const a = rx * dx + rz * dz;
    const l = -rx * dz + rz * dx;
    const F = pipeFloorAt(p, a, len);
    const h = y - (F + PIPE_AXIS_LIFT);
    let cyl = Math.sqrt(l * l + h * h) - PIPE_RADIUS;
    const cut = F - y;
    if (cut > cyl) cyl = cut;
    if (-a > cyl) cyl = -a;
    if (a - len > cyl) cyl = a - len;
    let chan = Math.abs(l) - CHANNEL_HALF;
    const c2 = F - CHANNEL_DEPTH - y;
    if (c2 > chan) chan = c2;
    const c3 = y - F;
    if (c3 > chan) chan = c3;
    const c4 = -CHANNEL_OVERRUN - a;
    if (c4 > chan) chan = c4;
    const c5 = a - len - CHANNEL_OVERRUN;
    if (c5 > chan) chan = c5;
    return chan < cyl ? chan : cyl;
  };
};

const shaftField = (p: ShaftPiece, top: number): FieldFn => {
  const { x: sx, z: sz, radius, bottom } = p;
  return (x, y, z) => {
    const px = x - sx;
    const pz = z - sz;
    let d = Math.sqrt(px * px + pz * pz) - radius;
    const d2 = bottom - y;
    if (d2 > d) d = d2;
    const d3 = y - top;
    return d3 > d ? d3 : d;
  };
};

export interface FieldOptions {
  /** The probe's view of a closed manhole: its shaft is air only up to SHAFT_CLOSED_BELOW_STREET under the street. */
  shaftOpen?: (shaft: ShaftPiece) => boolean;
  /** The player probe leaves the formations out. */
  withCones?: boolean;
}

const shaftTopOf = (shaft: ShaftPiece, open: boolean): number => shaft.street + (open ? SHAFT_ABOVE_STREET : -SHAFT_CLOSED_BELOW_STREET);

const pieceField = (p: TunnelPiece, options: FieldOptions): FieldFn | null => {
  switch (p.kind) {
    case "tube":
      return tubeField(p);
    case "mouth":
      return mouthField(p);
    case "room":
      return roomField(p);
    case "cone":
      return options.withCones === false ? null : coneField(p);
    case "box":
      return boxField(p);
    case "pipe":
      return pipeField(p);
    case "shaft":
      return shaftField(p, shaftTopOf(p, options.shaftOpen ? options.shaftOpen(p) : true));
  }
};

interface CompiledPiece {
  f: FieldFn;
  b: Bounds3;
}

/** Every piece's value: its field inside its bounds padded by FIELD_REACH, else FIELD_REACH. */
const pieceValue = (c: CompiledPiece, x: number, y: number, z: number): number => {
  const b = c.b;
  if (
    x < b.minX - FIELD_REACH ||
    x > b.maxX + FIELD_REACH ||
    y < b.minY - FIELD_REACH ||
    y > b.maxY + FIELD_REACH ||
    z < b.minZ - FIELD_REACH ||
    z > b.maxZ + FIELD_REACH
  )
    return FIELD_REACH;
  return c.f(x, y, z);
};

/**
 * The field over `pieces` (the subset of a system's pieces in reach of a region — the value is the
 * same from any subset holding the air; see the module comment). `omittedAir`: whether some air
 * piece was left out, so each system still reads FIELD_REACH where its listed pieces are far.
 */
export const compileField = (pieces: readonly TunnelPiece[], options: FieldOptions = {}): FieldFn => {
  interface SystemGroup {
    paths: Map<number, CompiledPiece[]>;
    cones: CompiledPiece[];
  }
  const systems = new Map<string, SystemGroup>();
  for (const p of pieces) {
    const f = pieceField(p, options);
    if (!f) continue;
    let s = systems.get(p.system);
    if (!s) systems.set(p.system, (s = { paths: new Map(), cones: [] }));
    const c = { f, b: p.bounds };
    if (p.kind === "cone") s.cones.push(c);
    else {
      let path = s.paths.get(p.path);
      if (!path) s.paths.set(p.path, (path = []));
      path.push(c);
    }
  }
  const groups = Array.from(systems.values(), (s) => ({ paths: Array.from(s.paths.values()), cones: s.cones }));
  if (groups.length === 0) return () => FIELD_REACH;
  return (x, y, z) => {
    let total = FIELD_REACH;
    for (let g = 0; g < groups.length; g++) {
      const { paths, cones } = groups[g];
      let sys = FIELD_REACH;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        let pv = FIELD_REACH;
        for (let j = 0; j < path.length; j++) {
          const v = pieceValue(path[j], x, y, z);
          if (v < pv) pv = v;
        }
        sys = i === 0 ? pv : smoothMin(sys, pv, JUNCTION_BLEND);
      }
      // A cone counts only inside its padded bounds (outside it adds nothing), so any subset of the
      // cones that reach a point reads the same.
      for (let i = 0; i < cones.length; i++) {
        const b = cones[i].b;
        if (x < b.minX - FIELD_REACH || x > b.maxX + FIELD_REACH || y < b.minY - FIELD_REACH || y > b.maxY + FIELD_REACH || z < b.minZ - FIELD_REACH || z > b.maxZ + FIELD_REACH) continue;
        const v = -cones[i].f(x, y, z);
        if (v > sys) sys = v;
      }
      if (sys < total) total = sys;
    }
    return total;
  };
};

// ── Bricks ────────────────────────────────────────────────────────────────

/** Distance from a box to a 3D point, 0 inside. */
const boxPointDistance = (b: Bounds3, x: number, y: number, z: number): number => {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0;
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/** A lower bound of the distance from a box to a segment: the box's distance to the nearest of a few
 *  points of the segment, less how far any point of the segment can be from the nearest sampled one. */
const boxSegmentDistanceBound = (b: Bounds3, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number => {
  const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
  const steps = Math.max(1, Math.ceil(len / 4));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = boxPointDistance(b, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    if (d < best) best = d;
  }
  return best - len / steps / 2;
};

/** A SOUND lower bound of a piece's field over a box (cones only add rock: +Infinity). */
const pieceLowerBound = (p: TunnelPiece, box: Bounds3): number => {
  switch (p.kind) {
    case "tube":
      return boxSegmentDistanceBound(box, p.ax, p.ay + AXIS_LIFT * p.ra, p.az, p.bx, p.by + AXIS_LIFT * p.rb, p.bz) - Math.max(p.ra * (1 + p.bulgeA), p.rb * (1 + p.bulgeB));
    case "mouth":
      return (
        boxSegmentDistanceBound(box, p.ox, p.oy + AXIS_LIFT * p.r0, p.oz, p.ox + p.dx * p.length, p.oy - p.grade * p.length + AXIS_LIFT * p.r1, p.oz + p.dz * p.length) -
        p.width
      );
    case "room":
      return boxSegmentDistanceBound(box, p.ax, p.ay + AXIS_LIFT * p.radius, p.az, p.bx, p.by + AXIS_LIFT * p.radius, p.bz) - p.radius * (1 + WALL_BULGE * 0.5);
    case "cone":
      return Infinity;
    case "box": {
      const pb = pieceBounds(p);
      return Math.max(boxPointDistance(box, (pb.minX + pb.maxX) / 2, (pb.minY + pb.maxY) / 2, (pb.minZ + pb.maxZ) / 2) - Math.hypot(pb.maxX - pb.minX, pb.maxY - pb.minY, pb.maxZ - pb.minZ) / 2, -Infinity);
    }
    case "pipe": {
      const lo = Math.min(p.floorA, p.floorB);
      const hi = Math.max(p.floorA, p.floorB);
      return boxSegmentDistanceBound(box, p.ax, lo + PIPE_AXIS_LIFT, p.az, p.bx, hi + PIPE_AXIS_LIFT, p.bz) - PIPE_RADIUS - CHANNEL_OVERRUN - (hi - lo);
    }
    case "shaft":
      return boxSegmentDistanceBound(box, p.x, p.bottom, p.z, p.x, p.street + SHAFT_ABOVE_STREET, p.z) - p.radius;
  }
};

/** Whether a box is provably all rock: every piece's lower bound clears the junctions' deepest dip —
 *  each smooth junction can dip JUNCTION_BLEND / 4 under the pieces, and a system of P paths meets in
 *  P − 1 of them (the lists are small: the distinct paths are counted in place). */
export const rockDipOf = (pieces: readonly TunnelPiece[]): number => {
  const paths = new Map<string, Set<number>>();
  for (const p of pieces) {
    if (p.kind === "cone") continue;
    let s = paths.get(p.system);
    if (!s) paths.set(p.system, (s = new Set()));
    s.add(p.path);
  }
  let deepest = 1;
  for (const s of paths.values()) if (s.size - 1 > deepest) deepest = s.size - 1;
  return (JUNCTION_BLEND / 4) * deepest;
};

export const boxIsRock = (pieces: readonly TunnelPiece[], box: Bounds3, dip = rockDipOf(pieces)): boolean => {
  for (const p of pieces) if (pieceLowerBound(p, box) <= dip + 1e-6) return false;
  return true;
};

/** Whether any piece's air can reach a box: its bounds touch it. */
export const airMayReach = (pieces: readonly TunnelPiece[], box: Bounds3): boolean => {
  for (const p of pieces) if (p.kind !== "cone" && boundsTouch(p.bounds, box)) return true;
  return false;
};

/** The pieces whose padded bounds touch a box: the subset a brick's field needs. */
export const piecesTouching = (pieces: readonly TunnelPiece[], box: Bounds3, pad = FIELD_REACH): TunnelPiece[] =>
  pieces.filter((p) => boundsTouch(p.bounds, box, pad));

// ── Probing ───────────────────────────────────────────────────────────────

/** The field is read at this many midpoints after the first rock sample, halving the bracket each time. */
const PROBE_BISECTIONS = 6;

/** The first rock along y from an air point (x, y0, z): `step`s in `dir` (+1 up, −1 down) to the first
 *  sample in rock, then the bracket bisected. NaN when the air runs on for `reach`. */
/** The gradient's step for rockEscapeAt, and how many pushes it takes (the field is a min of
 *  distances: one push lands exactly on a plane, a second settles a corner or a sloping floor). */
const ESCAPE_GRADIENT_STEP = 0.05;
const ESCAPE_PUSHES = 3;
/** A gradient this upright is a floor or a ceiling (the sunk rule's), not a wall. */
const ESCAPE_VERTICAL = 0.7;

export interface RockEscape {
  x: number;
  y: number;
  z: number;
  /** The rock was under or over the point (a floor or ceiling), not beside it. */
  vertical: boolean;
}

/** Where a point that stands in rock gets out: pushed down the field's gradient until the field is
 *  at most -clearance (air with that much to spare), in ESCAPE_PUSHES pushes. Null when the point is
 *  not in rock, or no air is reached (deep rock, where the field saturates with no gradient). */
export const rockEscapeAt = (field: FieldFn, x: number, y: number, z: number, clearance: number): RockEscape | null => {
  let f = field(x, y, z);
  if (f <= 0) return null;
  let vertical = false;
  const e = ESCAPE_GRADIENT_STEP;
  for (let k = 0; k < ESCAPE_PUSHES && f > -clearance; k++) {
    let gx = (field(x + e, y, z) - field(x - e, y, z)) / (2 * e);
    let gy = (field(x, y + e, z) - field(x, y - e, z)) / (2 * e);
    let gz = (field(x, y, z + e) - field(x, y, z - e)) / (2 * e);
    const len = Math.hypot(gx, gy, gz);
    // No gradient: deep rock (the field saturates), or the apex of a slot of air (a sewer's channel
    // reads its floor and its top alike at mid-height): in air that is as far out as it gets.
    if (len < 1e-3) break;
    gx /= len;
    gy /= len;
    gz /= len;
    if (k === 0) vertical = Math.abs(gy) >= ESCAPE_VERTICAL;
    const push = f + clearance;
    x -= gx * push;
    y -= gy * push;
    z -= gz * push;
    f = field(x, y, z);
  }
  return f < 0 ? { x, y, z, vertical } : null;
};

/** The surface of the air over a point that stands in rock: the first air found going up in `step`s
 *  within `reach`, bisected back to the rock's edge (PROBE_BISECTIONS). NaN when none. */
export const surfaceAboveAt = (field: FieldFn, x: number, y: number, z: number, step: number, reach: number): number => {
  let rock = y;
  let air = NaN;
  for (let s = step; s <= reach; s += step) {
    if (field(x, y + s, z) < 0) {
      air = y + s;
      break;
    }
    rock = y + s;
  }
  if (Number.isNaN(air)) return NaN;
  for (let k = 0; k < PROBE_BISECTIONS; k++) {
    const mid = (air + rock) / 2;
    if (field(x, mid, z) < 0) air = mid;
    else rock = mid;
  }
  return air;
};

export const probeRockAlongY = (field: FieldFn, x: number, y0: number, z: number, dir: 1 | -1, step: number, reach: number): number => {
  let air = y0;
  let rock = NaN;
  for (let s = step; s <= reach; s += step) {
    const y = y0 + dir * s;
    if (field(x, y, z) >= 0) {
      rock = y;
      break;
    }
    air = y;
  }
  if (Number.isNaN(rock)) return NaN;
  for (let k = 0; k < PROBE_BISECTIONS; k++) {
    const mid = (air + rock) / 2;
    if (field(x, mid, z) >= 0) rock = mid;
    else air = mid;
  }
  return (air + rock) / 2;
};
