/**
 * THE tunnels' air as one signed field, negative in the air: pieces of one path union plainly, paths
 * of one system meet in a smooth junction, formations are subtracted (rock), separate systems simply
 * overlap. A function of the point alone — a piece counts only inside its bounds padded by FIELD_REACH
 * (else as that far) and the wall noise only within NOISE_SHELL of a
 * wall — so every brick, chunk and thread reads the same bits from whatever subset of pieces holds the
 * air. Also a mouth's geometry (its outline, floor, footprint and cut), which the bulge, the terrain's
 * openings, the rocks and the bodies all read. Three-free.
 */

import Noise from "noise-ts";
import { seedRand, smoothMin } from "../../math";
import type { RectXZ } from "../../math/types";
import { WORLD_CHUNK_SIZE } from "../../../world/chunks/types";
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
  TUBE_CAP_FLOOR_RISE,
  WALL_BULGE,
} from "./constants";
import type { Bounds3, BoxPiece, ConePiece, MouthPiece, PipePiece, RoomPiece, ShaftPiece, TubePiece, TunnelPiece } from "./types";

export type FieldFn = (x: number, y: number, z: number) => number;

const noise = new Noise(seedRand("tunnel walls"));

// Both noises are functions of the point alone, and one field evaluation asks several pieces (every
// consecutive tube of a path reaches most samples near it) at the SAME point: the last point's value is
// kept, keyed on the exact coordinates, so a sample pays each noise once (DECISIONS.md).
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

/** A mouth's ragged outline in [−1, 1]: four sines of the angle about the axis and the distance along it. */
const rimNoise = (theta: number, along: number, phase: number): number =>
  0.25 * (Math.sin(2 * theta + 0.7 * along + 1.7 * phase) + Math.sin(3 * theta + phase) + Math.sin(5 * theta + 0.4 * along - 2 * phase) + Math.sin(7 * theta - 0.3 * along + 0.6 * phase));

// ── Mouth geometry ─────────────────────────────────────────────────────────

const clampAlong = (m: MouthPiece, along: number): number => (along < 0 ? 0 : along > m.length ? m.length : along);

/** The section's plain radius at `along`: r0 over its first SECTION_FULL_SHARE, then a linear taper to r1. */
export const mouthRadiusAt = (m: MouthPiece, along: number): number => {
  const full = m.length * SECTION_FULL_SHARE;
  if (along <= full) return m.r0;
  if (along >= m.length) return m.r1;
  return m.r0 + (m.r1 - m.r0) * ((along - full) / (m.length - full));
};

/** The section's floor at `along` (held level past either end). */
export const mouthFloorAt = (m: MouthPiece, along: number): number => m.oy - m.grade * clampAlong(m, along);

/** How much of the ragged swing is left at `along`: all of it at the opening, none at the inner end. */
const raggedShare = (m: MouthPiece, along: number): number => 1 - clampAlong(m, along) / m.length;

/** The widest outline at `along`: the radius swung fully out by what is left of the rim's amplitude. */
export const mouthWidthAt = (m: MouthPiece, along: number): number => mouthRadiusAt(m, along) * (1 + MOUTH_RIM_AMP * raggedShare(m, along));

/** The height of the point a mouth's daylight falls from: its axis over the opening (x/z are the opening's).
 *  The ONE daylight rule's source — the walls' baked daylight, the player's light and the actors' alike. */
export const mouthLightY = (m: MouthPiece): number => m.oy + AXIS_LIFT * m.r0;

/** Along the section from the opening, and across it (to the left of its direction). */
export const mouthAlong = (m: MouthPiece, x: number, z: number): number => (x - m.ox) * m.dx + (z - m.oz) * m.dz;
export const mouthLateral = (m: MouthPiece, x: number, z: number): number => -(x - m.ox) * m.dz + (z - m.oz) * m.dx;

/** Horizontal distance from a point to the section (the segment from the opening to the inner end). */
export const mouthSectionDistance = (m: MouthPiece, x: number, z: number): number => {
  const a = clampAlong(m, mouthAlong(m, x, z));
  return Math.hypot(x - (m.ox + m.dx * a), z - (m.oz + m.dz * a));
};

/** Horizontal distance from the section to a rectangle (0 where they meet): for two convex shapes apart,
 *  the nearest pair has an end of the segment or a corner of the rectangle in it. */
export const mouthSectionDistanceToRect = (m: MouthPiece, rect: RectXZ): number => {
  const ax = m.ox;
  const az = m.oz;
  const bx = m.ox + m.dx * m.length;
  const bz = m.oz + m.dz * m.length;
  // Clipped to the rectangle (Liang–Barsky): any part inside means they meet.
  let t0 = 0;
  let t1 = 1;
  const ex = bx - ax;
  const ez = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-ex, ax - rect.minX) && clip(ex, rect.maxX - ax) && clip(-ez, az - rect.minZ) && clip(ez, rect.maxZ - az) && t0 <= t1) return 0;
  const toRect = (x: number, z: number): number => Math.hypot(Math.max(rect.minX - x, 0, x - rect.maxX), Math.max(rect.minZ - z, 0, z - rect.maxZ));
  return Math.min(
    toRect(ax, az),
    toRect(bx, bz),
    mouthSectionDistance(m, rect.minX, rect.minZ),
    mouthSectionDistance(m, rect.maxX, rect.minZ),
    mouthSectionDistance(m, rect.minX, rect.maxZ),
    mouthSectionDistance(m, rect.maxX, rect.maxZ),
  );
};

/** A mouth's FOOTPRINT: the capsule along its section this much wider than its widest outline — where
 *  the entrance is one surface of ground and walls, and the terrain is cut (less the band). */
export const mouthFootprintRadius = (m: MouthPiece): number => m.width + FOOTPRINT_PAD;
export const insideMouthFootprint = (m: MouthPiece, x: number, z: number, inset = 0): boolean => mouthSectionDistance(m, x, z) < mouthFootprintRadius(m) - inset;
export const mouthFootprintReaches = (m: MouthPiece, rect: RectXZ): boolean => mouthSectionDistanceToRect(m, rect) < mouthFootprintRadius(m);

/** Every streaming chunk ("minX,minZ") the footprint spans: the entrance shows once all are loaded. */
export const mouthFootprintCells = (m: MouthPiece): string[] => {
  const r = mouthFootprintRadius(m);
  const bx = m.ox + m.dx * m.length;
  const bz = m.oz + m.dz * m.length;
  const s = WORLD_CHUNK_SIZE;
  const cells: string[] = [];
  for (let ix = Math.floor((Math.min(m.ox, bx) - r) / s); ix <= Math.floor((Math.max(m.ox, bx) + r) / s); ix++) {
    for (let iz = Math.floor((Math.min(m.oz, bz) - r) / s); iz <= Math.floor((Math.max(m.oz, bz) + r) / s); iz++) {
      if (mouthFootprintReaches(m, { minX: ix * s, minZ: iz * s, maxX: ix * s + s, maxZ: iz * s + s })) cells.push(`${ix * s},${iz * s}`);
    }
  }
  return cells;
};

/** How high over the section's floor the terrain is cut inside the footprint (the terrain shader's
 *  `mouthCutsHere`, from the hole's capHeight): the opening's crown and its hood, no more. */
export const mouthCutCeiling = (m: MouthPiece): number => m.r0 * MOUTH_HOLE_CAP_RADII + MOUTH_HOLE_CAP_PAD;

/** Whether a point is in a mouth's CUT: its footprint, under the cut's ceiling over the section's floor
 *  (the same numbers the terrain shader cuts by). There the entrance patch is the ground. */
export const insideMouthCut = (m: MouthPiece, x: number, y: number, z: number): boolean =>
  y < mouthFloorAt(m, mouthAlong(m, x, z)) + mouthCutCeiling(m) && insideMouthFootprint(m, x, z);


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
      const r = Math.max(p.ra, p.rb) * (1 + Math.max(p.bulgeA, p.bulgeB)) + FLOOR_BUMP;
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

/** A tube: round about its axis (AXIS_LIFT radii over the floor, the radius interpolated along it), cut
 *  flat at the floor, which rises at TUBE_CAP_FLOOR_RISE past either end into the round cap. The wall
 *  lumps and floor bumps grow with bulge/bump, drawn only within NOISE_SHELL of the wall or floor. */
const tubeField = (p: TubePiece): FieldFn => {
  const { ax, az, ra, rb, bulgeA, bulgeB, bumpA, bumpB } = p;
  const ay = p.ay + AXIS_LIFT * ra;
  const ex = p.bx - ax;
  const ey = p.by + AXIS_LIFT * rb - ay;
  const ez = p.bz - az;
  const len2 = ex * ex + ey * ey + ez * ez;
  const len = Math.sqrt(len2);
  const floorY = p.ay;
  const floorRise = p.by - p.ay;
  return (x, y, z) => {
    let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2 : 0;
    let over = 0;
    if (t < 0) {
      over = -t * len;
      t = 0;
    } else if (t > 1) {
      over = (t - 1) * len;
      t = 1;
    }
    const r = ra + (rb - ra) * t;
    const dx = x - (ax + ex * t);
    const dy = y - (ay + ey * t);
    const dz = z - (az + ez * t);
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    const bulge = bulgeA + (bulgeB - bulgeA) * t;
    if (bulge > 0 && d < NOISE_SHELL && d > -NOISE_SHELL) d += r * bulge * wallNoise(x, y, z);
    let cutY = floorY + floorRise * t + TUBE_CAP_FLOOR_RISE * over;
    const bump = bumpA + (bumpB - bumpA) * t;
    if (bump > 0 && y - cutY < NOISE_SHELL && cutY - y < NOISE_SHELL) cutY += bump * bumpNoise(x, z);
    const cut = cutY - y;
    return cut > d ? cut : d;
  };
};

/** A mouth: its section, round at the local radius swung by the ragged outline, cut flat at its floor,
 *  closed past the opening's plane (the open air in front is the ground's, in the mesher) and past the
 *  inner end's (the trunk's first tube carries on with the same section). */
const mouthField = (m: MouthPiece): FieldFn => {
  const { ox, oz, dx, dz, length, phase } = m;
  return (x, y, z) => {
    const rx = x - ox;
    const rz = z - oz;
    const a = rx * dx + rz * dz;
    const l = -rx * dz + rz * dx;
    const along = a < 0 ? 0 : a > length ? length : a;
    const r = mouthRadiusAt(m, along);
    const floor = m.oy - m.grade * along;
    const h = y - (floor + AXIS_LIFT * r);
    const swing = MOUTH_RIM_AMP * (1 - along / length);
    // The rim runs on past the opening (its sines read the unclamped distance along).
    const outline = swing > 0 ? r * (1 + swing * rimNoise(Math.atan2(h, l), a, phase)) : r;
    let d = Math.sqrt(l * l + h * h) - outline;
    const cut = floor - y;
    if (cut > d) d = cut;
    if (a < 0 && -a > d) d = -a;
    else if (a > length && a - length > d) d = a - length;
    return d;
  };
};

const mouthFields = new WeakMap<MouthPiece, FieldFn>();

/** Whether a point lies in a mouth's own air (inside its ragged outline, over its floor, within its section). */
export const insideMouthOpening = (m: MouthPiece, x: number, y: number, z: number): boolean => {
  let f = mouthFields.get(m);
  if (!f) {
    f = mouthField(m);
    mouthFields.set(m, f);
  }
  return f(x, y, z) < 0;
};

/** A room: a wide capsule between its floor points' axes, its wall lumped by half a passage's, cut flat
 *  at its floor and bumped like one. */
const roomField = (p: RoomPiece): FieldFn => {
  const { ax, ay, az, radius } = p;
  const lift = AXIS_LIFT * radius;
  const ex = p.bx - ax;
  const ey = p.by - ay;
  const ez = p.bz - az;
  const len2 = ex * ex + ey * ey + ez * ez;
  const bulge = radius * WALL_BULGE * 0.5;
  return (x, y, z) => {
    let t = len2 > 0 ? ((x - ax) * ex + (y - ay - lift) * ey + (z - az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const floor = ay + ey * t;
    const dx = x - (ax + ex * t);
    const dy = y - (floor + lift);
    const dz = z - (az + ez * t);
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
    if (d < NOISE_SHELL && d > -NOISE_SHELL) d += bulge * wallNoise(x, y, z);
    let cutY = floor;
    if (y - cutY < NOISE_SHELL && cutY - y < NOISE_SHELL) cutY += FLOOR_BUMP * bumpNoise(x, z);
    const cut = cutY - y;
    return cut > d ? cut : d;
  };
};

/** A formation's ROCK (negative inside): a vertical cone from its root, `radius` wide there, to its tip. */
const coneField = (c: ConePiece): FieldFn => {
  const { x: cx, y: cy, z: cz, length, radius, dir } = c;
  return (x, y, z) => {
    // Written out as the old field (sqrt, not hypot; t clamped after the divide): any reordering moves
    // the formations' surfaces by ulps (DECISIONS.md "Restored after the rebuild").
    const along = (y - cy) * dir;
    const t = along / length;
    const px = x - cx;
    const pz = z - cz;
    let d = Math.sqrt(px * px + pz * pz) - radius * (1 - (t < 0 ? 0 : t > 1 ? 1 : t));
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


const pieceField = (p: TunnelPiece, options: FieldOptions): FieldFn => {
  switch (p.kind) {
    case "tube":
      return tubeField(p);
    case "mouth":
      return mouthField(p);
    case "room":
      return roomField(p);
    case "cone":
      return coneField(p);
    case "box":
      return boxField(p);
    case "pipe":
      return pipeField(p);
    case "shaft":
      return shaftField(p, shaftTopOf(p, options.shaftOpen ? options.shaftOpen(p) : true));
  }
};

/** A piece ready to evaluate: its field and its bounds padded by FIELD_REACH (outside, it is not there). */
interface CompiledPiece {
  field: FieldFn;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface CompiledSystem {
  /** Its paths in ascending id order (the smooth junction is not associative: every reader folds alike). */
  paths: CompiledPiece[][];
  cones: CompiledPiece[];
}

const compilePiece = (p: TunnelPiece, options: FieldOptions): CompiledPiece => ({
  field: pieceField(p, options),
  minX: p.bounds.minX - FIELD_REACH,
  minY: p.bounds.minY - FIELD_REACH,
  minZ: p.bounds.minZ - FIELD_REACH,
  maxX: p.bounds.maxX + FIELD_REACH,
  maxY: p.bounds.maxY + FIELD_REACH,
  maxZ: p.bounds.maxZ + FIELD_REACH,
});

const outOfReach = (c: CompiledPiece, x: number, y: number, z: number): boolean => x < c.minX || x > c.maxX || y < c.minY || y > c.maxY || z < c.minZ || z > c.maxZ;

/** The field of a set of pieces: per system, each path the plain minimum of its pieces (one out of reach
 *  counts as FIELD_REACH), the paths joined by the smooth junction, the formations cut out of the result;
 *  the systems' minimum, never past FIELD_REACH (rock as far as the field knows). Whatever subset holds
 *  the air, the field's sign and its values within the junction's reach of the air read alike. */
export const compileField = (pieces: readonly TunnelPiece[], options: FieldOptions = {}): FieldFn => {
  const withCones = options.withCones ?? true;
  const bySystem = new Map<string, { paths: Map<number, CompiledPiece[]>; cones: CompiledPiece[] }>();
  for (const p of pieces) {
    if (p.kind === "cone" && !withCones) continue;
    let s = bySystem.get(p.system);
    if (!s) {
      s = { paths: new Map(), cones: [] };
      bySystem.set(p.system, s);
    }
    const c = compilePiece(p, options);
    if (p.kind === "cone") {
      s.cones.push(c);
      continue;
    }
    const path = s.paths.get(p.path);
    if (path) path.push(c);
    else s.paths.set(p.path, [c]);
  }
  const systems: CompiledSystem[] = [];
  for (const s of bySystem.values()) {
    const ids = Array.from(s.paths.keys()).sort((a, b) => a - b);
    systems.push({ paths: ids.map((id) => s.paths.get(id)!), cones: s.cones });
  }
  return (x, y, z) => {
    let total = FIELD_REACH;
    for (const s of systems) {
      let air = FIELD_REACH;
      for (let k = 0; k < s.paths.length; k++) {
        let nearest = FIELD_REACH;
        for (const c of s.paths[k]) {
          if (outOfReach(c, x, y, z)) continue;
          const v = c.field(x, y, z);
          if (v < nearest) nearest = v;
        }
        air = k === 0 ? nearest : smoothMin(air, nearest, JUNCTION_BLEND);
      }
      for (const c of s.cones) {
        if (outOfReach(c, x, y, z)) continue;
        const rock = -c.field(x, y, z);
        if (rock > air) air = rock;
      }
      if (air < total) total = air;
    }
    return total;
  };
};

// ── Bricks ────────────────────────────────────────────────────────────────

/** The distance from a point to a box (0 inside). */
const boxPointDistance = (b: Bounds3, x: number, y: number, z: number): number =>
  Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY), Math.max(b.minZ - z, 0, z - b.maxZ));

/** A LOWER bound of the distance from a box to a segment: the distance along the segment is convex, so a
 *  golden-section search brackets its minimum, less what the bracket left over (the distance moves at
 *  most the segment's length per unit of t). */
const boxSegmentDistanceBound = (b: Bounds3, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number => {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const at = (t: number): number => boxPointDistance(b, ax + ex * t, ay + ey * t, az + ez * t);
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = 0;
  let hi = 1;
  let c = hi - g * (hi - lo);
  let d = lo + g * (hi - lo);
  let fc = at(c);
  let fd = at(d);
  for (let k = 0; k < 24; k++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - g * (hi - lo);
      fc = at(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + g * (hi - lo);
      fd = at(d);
    }
  }
  const best = Math.min(fc, fd, at(0), at(1));
  return best - Math.sqrt(ex * ex + ey * ey + ez * ez) * (hi - lo);
};

/** A sound lower bound of a piece's air field over a box (formations only add rock: −Infinity, never
 *  claimed; sewer pieces are never settled this way). */
const pieceLowerBound = (p: TunnelPiece, box: Bounds3): number => {
  switch (p.kind) {
    case "tube": {
      // The tube's distance is to a point of its axis (the caps: its ends), never nearer than the axis
      // segment; the wall swings out by at most the larger radius's largest lump (the two interpolate
      // apart, so their product can peak between the ends).
      const swing = Math.max(p.ra, p.rb) * (1 + Math.max(p.bulgeA, p.bulgeB));
      return boxSegmentDistanceBound(box, p.ax, p.ay + AXIS_LIFT * p.ra, p.az, p.bx, p.by + AXIS_LIFT * p.rb, p.bz) - swing;
    }
    case "mouth": {
      // The axis bends where the taper starts; past either end the plane takes over, which at worst
      // halves the bound.
      const full = p.length * SECTION_FULL_SHARE;
      const ax = p.ox;
      const ay = p.oy + AXIS_LIFT * p.r0;
      const az = p.oz;
      const fx = p.ox + p.dx * full;
      const fy = p.oy - p.grade * full + AXIS_LIFT * p.r0;
      const fz = p.oz + p.dz * full;
      const bx = p.ox + p.dx * p.length;
      const by = p.oy - p.grade * p.length + AXIS_LIFT * p.r1;
      const bz = p.oz + p.dz * p.length;
      const d = Math.min(boxSegmentDistanceBound(box, ax, ay, az, fx, fy, fz), boxSegmentDistanceBound(box, fx, fy, fz, bx, by, bz)) - p.width;
      return d > 0 ? d / 2 : d;
    }
    case "room":
      return (
        boxSegmentDistanceBound(box, p.ax, p.ay + AXIS_LIFT * p.radius, p.az, p.bx, p.by + AXIS_LIFT * p.radius, p.bz) - p.radius * (1 + WALL_BULGE * 0.5)
      );
    default:
      return -Infinity;
  }
};

/** How far the smooth junctions can pull a system's field under its pieces' least value: P paths fold
 *  P − 1 times, each at most a quarter of the blend. */
export const rockDipOf = (pieces: readonly TunnelPiece[]): number => {
  const paths = new Map<string, Set<number>>();
  for (const p of pieces) {
    if (p.kind === "cone") continue;
    let s = paths.get(p.system);
    if (!s) paths.set(p.system, (s = new Set()));
    s.add(p.path);
  }
  let dip = 0;
  for (const s of paths.values()) dip = Math.max(dip, ((s.size - 1) * JUNCTION_BLEND) / 4);
  return dip;
};

/** Whether the field is provably rock over the whole box: every piece in reach stays clear of it by more
 *  than the junctions' dip. */
export const boxIsRock = (pieces: readonly TunnelPiece[], box: Bounds3, dip = rockDipOf(pieces)): boolean => {
  // A piece out of reach counts as FIELD_REACH: the junctions must not be able to pull that to the air.
  if (dip >= FIELD_REACH) return false;
  for (const p of pieces) {
    if (p.kind === "cone" || !boundsTouch(p.bounds, box, FIELD_REACH)) continue;
    if (pieceLowerBound(p, box) - dip <= 0) return false;
  }
  return true;
};

/** Whether any piece's air can reach the box (by the pieces' bounds, which hold their air). */
export const airMayReach = (pieces: readonly TunnelPiece[], box: Bounds3): boolean => {
  for (const p of pieces) if (p.kind !== "cone" && boundsTouch(p.bounds, box)) return true;
  return false;
};

/** The pieces whose field reaches a box padded by `pad`: a brick's subset. */
export const piecesTouching = (pieces: readonly TunnelPiece[], box: Bounds3, pad = FIELD_REACH): TunnelPiece[] => pieces.filter((p) => boundsTouch(p.bounds, box, pad));


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
