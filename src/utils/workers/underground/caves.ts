/**
 * One CAVE system per biome cell: an entry mouth where the biome's ground first climbs into the
 * mountain (or higher up the slope), maybe an exit opposite, a trunk between them (a bow) or from the
 * entry round a ring and back (a loop), blind branches off it, side rooms (<Rooms>), and formations.
 * Layout and decoration draw from SEPARATE seeded streams, so decoration never moves a passage; the
 * side rooms are the layout's last draws, so a cave without <Rooms> keeps its passages. Generated on
 * the UN-bulged ground (systems.ts). Also the mouths' rock SPOTS, placed on demand on the bulged
 * ground. Three-free.
 */

import { smoothstep } from "../../math";
import { seededStream, type SeededStream } from "../../math/seededStream";
import type { PointXZ } from "../../math/types";
import type { CaveSideRoomParams } from "../types";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../water/rivers/constants";
import { computeVertexData } from "../vertexCompute";
import {
  AXIS_LIFT,
  BOW_WANDER,
  BRANCH_EASE,
  BRANCH_FLOOR_WALK,
  BRANCH_END_CLEAR,
  BRANCH_LENGTH_MAX,
  BRANCH_LENGTH_MIN,
  BRANCH_MAX,
  BRANCH_MIN,
  BRANCH_RADIUS_MAX,
  BRANCH_RADIUS_MIN,
  BRANCH_SHORTEST,
  BRANCH_TRIES,
  BRANCH_TURN_MAX,
  BRANCH_TURN_MIN,
  BRANCH_WANDER,
  BRANCH_WAVES,
  EXIT_CHANCE,
  EXIT_CLEAR,
  EXIT_TRIES,
  EXIT_TURN,
  FLOOR_BUMP,
  FLOOR_GRADE,
  FLOOR_HALF_WIDTH,
  FLOOR_SWELL,
  FLOOR_SWELL_FADE,
  FLOOR_WAVE_MAX,
  FLOOR_WAVE_MIN,
  FORMATION_MOUTH_CLEAR,
  FORMATION_ROOT,
  FORMATION_SHORTEST,
  FORMATION_STEP,
  HIGH_MOUTH_CHANCE,
  HIGH_MOUTH_CLIMB,
  HIGH_MOUTH_GRADE,
  HIGH_MOUTH_GRADE_RUN,
  HIGH_MOUTH_RISE_MAX,
  HIGH_MOUTH_RISE_MIN,
  INNER_RADIUS_MAX,
  INNER_RADIUS_MIN,
  LOOP_JITTER,
  LOOP_LEAD_MAX,
  LOOP_LEAD_MIN,
  LOOP_POINTS,
  LOOP_RADIUS_MAX,
  LOOP_RADIUS_MIN,
  LOOP_SETTLE_ROUNDS,
  MASK_RUN_SEGMENTS,
  MOUTH_FOOT_GRADE,
  MOUTH_FOOT_RUN,
  MOUTH_FOOT_STEP,
  MOUTH_GRADE,
  MOUTH_RAYS,
  MOUTH_RIM_AMP,
  MOUTH_ROAD_CLEAR,
  MOUTH_ROCK_APPROACH_IN,
  MOUTH_ROCK_APPROACH_PAD,
  MOUTH_ROCK_COUNT_MAX,
  MOUTH_ROCK_COUNT_MIN,
  MOUTH_ROCK_FAR_KEEP,
  MOUTH_ROCK_FRONT_SHARE,
  MOUTH_ROCK_GRID,
  MOUTH_ROCK_REACH_RADII,
  MOUTH_ROCK_RISE,
  MOUTH_ROCK_SETBACK,
  MOUTH_ROCK_SIDE_PAD,
  MOUTH_ROCK_SIZE_MAX,
  MOUTH_ROCK_SIZE_MIN,
  MOUTH_ROCK_SPACING_PAD,
  MOUTH_ROCK_TRIES,
  MOUTH_SEARCH_REACH,
  MOUTH_SEARCH_STEP,
  MOUTH_SITE_CLEAR,
  MOUTH_STEEP_GRADE,
  MOUTH_WATER_CLEAR,
  OPENING_RADIUS_MAX,
  OPENING_RADIUS_MIN,
  PASSAGE_RADIUS_MAX,
  PASSAGE_RADIUS_MIN,
  PASSAGE_WAVES,
  PATH_CLEARANCE,
  RADIUS_EASE_END,
  RADIUS_EASE_START,
  ROOM_FORMATION_TRIES,
  ROOM_LENGTH_MAX,
  ROOM_LENGTH_MIN,
  ROOM_MOUTH_CLEAR,
  ROOM_RADIUS_MAX,
  ROOM_RADIUS_MIN,
  ROOM_STALACTITE_LENGTH_MAX,
  ROOM_STALAGMITE_HEIGHT_MAX,
  ROOM_TRIES,
  ROOM_TURN,
  SECTION_FIT_STEP,
  SECTION_LENGTH_MAX,
  SECTION_LENGTH_MIN,
  SECTION_LENGTH_STEP,
  STALACTITE_CHANCE,
  STALACTITE_LENGTH_MAX,
  STALACTITE_LENGTH_MIN,
  STALACTITE_RADIUS_MAX,
  STALACTITE_RADIUS_MIN,
  STALACTITE_SPREAD,
  STALACTITE_TIP_CLEAR,
  STALAGMITE_CEILING_CLEAR,
  STALAGMITE_CHANCE,
  STALAGMITE_HEIGHT_MAX,
  STALAGMITE_HEIGHT_MIN,
  STALAGMITE_MIN_HALF_WIDTH,
  STALAGMITE_RADIUS_MAX,
  STALAGMITE_RADIUS_MIN,
  STALAGMITE_WALL_MAX,
  STALAGMITE_WALL_MIN,
  TRUNK_LEAD,
  WALL_BULGE,
} from "./constants";
import { coverFloorAt, eased, limitGrade, pointAt, resample, sideAt, smoothCourse, tubesOf, type PathSample } from "./paths";
import { compileField, emptyBounds, growBounds, insideMouthOpening, mouthFloorAt, probeRockAlongY, withBounds, type FieldFn } from "./tunnelField";
import type { ConePiece, MouthPiece, RockSpot, RoomPiece, SkirtMask, TunnelPiece, TunnelSystem } from "./types";

const TAU = Math.PI * 2;

const groundAt = (x: number, z: number): number => computeVertexData(x, z).height;

/** Fit ground for a mouth: not under or within MOUTH_WATER_CLEAR of water, out of the river's keep-off,
 *  not under a deck, MOUTH_ROAD_CLEAR past a road's or freeway's half width. */
const fitGround = (x: number, z: number): boolean => {
  const vd = computeVertexData(x, z);
  if (!Number.isNaN(vd.waterHeight) && vd.waterHeight > vd.height - MOUTH_WATER_CLEAR) return false;
  if (vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) return false;
  const city = domainConfig!.cityConfig;
  return vd.distanceToRoadCenter >= city.roadWidth + MOUTH_ROAD_CLEAR && vd.distanceToFreewayCenter >= city.freewayWidth + MOUTH_ROAD_CLEAR;
};

// ── Mouths ────────────────────────────────────────────────────────────────

/** A mouth as planned: its opening, its direction INTO the mountain, its section and radii. */
interface MouthPlan {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  length: number;
  r0: number;
  r1: number;
}

/** A ray's FOOT: out from the site until the biome ends, then back in to the first spot climbing
 *  MOUTH_FOOT_GRADE; null when there is none, or it stands too near the site or on unfit ground. */
const footOnRay = (site: PointXZ, ux: number, uz: number, biomeId: number): { s: number; x: number; z: number; y: number } | null => {
  let edge = -1;
  for (let s = MOUTH_SEARCH_STEP; s <= MOUTH_SEARCH_REACH; s += MOUTH_SEARCH_STEP) {
    if (computeVertexData(site.x + ux * s, site.z + uz * s).biomeId !== biomeId) {
      edge = s;
      break;
    }
  }
  if (edge < 0) return null;
  for (let s = edge; s >= MOUTH_SITE_CLEAR; s -= MOUTH_FOOT_STEP) {
    const x = site.x + ux * s;
    const z = site.z + uz * s;
    const y = groundAt(x, z);
    if (groundAt(x - ux * MOUTH_FOOT_RUN, z - uz * MOUTH_FOOT_RUN) - y < MOUTH_FOOT_GRADE * MOUTH_FOOT_RUN) continue;
    return fitGround(x, z) ? { s, x, z, y } : null;
  }
  return null;
};

/** The shortest section from an opening into the mountain that keeps ROCK_COVER over the inner end's
 *  bulged crown (coverFloorAt with the full WALL_BULGE), on fit ground all along; null when none. */
const sectionLength = (x: number, y: number, z: number, dx: number, dz: number, r1: number): number | null => {
  let fitTo = -SECTION_FIT_STEP;
  for (let length = SECTION_LENGTH_MIN; length <= SECTION_LENGTH_MAX; length += SECTION_LENGTH_STEP) {
    while (fitTo + SECTION_FIT_STEP <= length) {
      fitTo += SECTION_FIT_STEP;
      if (!fitGround(x + dx * fitTo, z + dz * fitTo)) return null;
    }
    if (coverFloorAt(x + dx * length, z + dz * length, r1, WALL_BULGE, -dz, dx) >= y - MOUTH_GRADE * length) return length;
  }
  return null;
};

const planAt = (x: number, y: number, z: number, dx: number, dz: number, r0: number, r1: number): MouthPlan | null => {
  const length = sectionLength(x, y, z, dx, dz, r1);
  return length === null ? null : { x, y, z, dx, dz, length, r0, r1 };
};

/** A HIGH mouth: on up the ray from its foot to `rise` over it, the first spot no steeper than
 *  HIGH_MOUTH_GRADE along the ray whose section fits; null when none does before HIGH_MOUTH_RISE_MAX
 *  over the foot or within HIGH_MOUTH_CLIMB. */
const climbFrom = (site: PointXZ, ux: number, uz: number, foot: { s: number; y: number }, rise: number, r0: number, r1: number): MouthPlan | null => {
  for (let s = foot.s - MOUTH_SEARCH_STEP; s >= MOUTH_SITE_CLEAR && foot.s - s <= HIGH_MOUTH_CLIMB; s -= MOUTH_SEARCH_STEP) {
    const x = site.x + ux * s;
    const z = site.z + uz * s;
    const y = groundAt(x, z);
    if (y < foot.y + rise) continue;
    if (y > foot.y + HIGH_MOUTH_RISE_MAX) return null;
    const grade = Math.abs(groundAt(x - ux * HIGH_MOUTH_GRADE_RUN, z - uz * HIGH_MOUTH_GRADE_RUN) - groundAt(x + ux * HIGH_MOUTH_GRADE_RUN, z + uz * HIGH_MOUTH_GRADE_RUN)) / (2 * HIGH_MOUTH_GRADE_RUN);
    if (grade > HIGH_MOUTH_GRADE || !fitGround(x, z)) continue;
    const plan = planAt(x, y, z, -ux, -uz, r0, r1);
    if (plan) return plan;
  }
  return null;
};

/** The entry: tried along MOUTH_RAYS rays from a random base angle, the first that yields a mouth. */
const findEntry = (site: PointXZ, biomeId: number, layout: SeededStream): { plan: MouthPlan; angle: number } | null => {
  const base = layout.next() * TAU;
  for (let k = 0; k < MOUTH_RAYS; k++) {
    const angle = base + (k * TAU) / MOUTH_RAYS;
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const r0 = layout.between(OPENING_RADIUS_MIN, OPENING_RADIUS_MAX);
    const r1 = layout.between(INNER_RADIUS_MIN, INNER_RADIUS_MAX);
    const high = layout.next() < HIGH_MOUTH_CHANCE;
    const rise = layout.between(HIGH_MOUTH_RISE_MIN, HIGH_MOUTH_RISE_MAX);
    const foot = footOnRay(site, ux, uz, biomeId);
    if (!foot) continue;
    const plan = (high ? climbFrom(site, ux, uz, foot, rise, r0, r1) : null) ?? planAt(foot.x, foot.y, foot.z, -ux, -uz, r0, r1);
    if (plan) return { plan, angle };
  }
  return null;
};

/** The exit: roughly opposite the entry, at a foot, clear of the entry; null when none fits. */
const findExit = (site: PointXZ, biomeId: number, entry: { plan: MouthPlan; angle: number }, layout: SeededStream): MouthPlan | null => {
  for (let t = 0; t < EXIT_TRIES; t++) {
    const angle = entry.angle + Math.PI + layout.between(-EXIT_TURN, EXIT_TURN);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const r0 = layout.between(OPENING_RADIUS_MIN, OPENING_RADIUS_MAX);
    const r1 = layout.between(INNER_RADIUS_MIN, INNER_RADIUS_MAX);
    const foot = footOnRay(site, ux, uz, biomeId);
    if (!foot || Math.hypot(foot.x - entry.plan.x, foot.z - entry.plan.z) < EXIT_CLEAR) continue;
    const plan = planAt(foot.x, foot.y, foot.z, -ux, -uz, r0, r1);
    if (plan) return plan;
  }
  return null;
};

const innerEnd = (m: MouthPlan): PointXZ => ({ x: m.x + m.dx * m.length, z: m.z + m.dz * m.length });
const innerFloor = (m: MouthPlan): number => m.y - MOUTH_GRADE * m.length;

// ── The trunk ─────────────────────────────────────────────────────────────

interface Trunk {
  samples: PathSample[];
  /** A loop's junction: the sample indices of its two visits. */
  junction: [number, number] | null;
}

/** The bow between two inner ends: a lead out of each mouth, wandering sideways at the quarter points. */
const bowCourse = (entry: MouthPlan, exit: MouthPlan, layout: SeededStream): PointXZ[] => {
  const i0 = innerEnd(entry);
  const i1 = innerEnd(exit);
  const a = { x: i0.x + entry.dx * TRUNK_LEAD, z: i0.z + entry.dz * TRUNK_LEAD };
  const b = { x: i1.x + exit.dx * TRUNK_LEAD, z: i1.z + exit.dz * TRUNK_LEAD };
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const px = -(b.z - a.z) / len;
  const pz = (b.x - a.x) / len;
  const points: PointXZ[] = [i0, a];
  for (let k = 1; k <= 3; k++) {
    const w = layout.between(-BOW_WANDER[k - 1], BOW_WANDER[k - 1]);
    points.push({ x: a.x + ((b.x - a.x) * k) / 4 + px * w, z: a.z + ((b.z - a.z) * k) / 4 + pz * w });
  }
  points.push(b, i1);
  return smoothCourse(points, false, { x: entry.dx, z: entry.dz });
};

/** A loop's course: a lead out of the entry to its junction, then a jittered ring beside the lead,
 *  leaving the junction along the lead and coming back into it. */
const loopCourse = (entry: MouthPlan, layout: SeededStream): { lead: PointXZ[]; ring: PointXZ[] } => {
  const i0 = innerEnd(entry);
  const lead = layout.between(LOOP_LEAD_MIN, LOOP_LEAD_MAX);
  const j = { x: i0.x + entry.dx * lead, z: i0.z + entry.dz * lead };
  const radius = layout.between(LOOP_RADIUS_MIN, LOOP_RADIUS_MAX);
  const side = layout.signedUnit();
  const cx = j.x - entry.dz * side * radius;
  const cz = j.z + entry.dx * side * radius;
  const start = Math.atan2(j.z - cz, j.x - cx);
  // Round the way the lead points: the ring's tangent at the junction is the lead's direction.
  const turn = -Math.sin(start) * entry.dx + Math.cos(start) * entry.dz > 0 ? 1 : -1;
  const ring: PointXZ[] = [j];
  for (let k = 1; k < LOOP_POINTS; k++) {
    const r = radius * (1 + layout.between(-LOOP_JITTER, LOOP_JITTER));
    const angle = start + (turn * k * TAU) / LOOP_POINTS;
    ring.push({ x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r });
  }
  return { lead: [i0, j], ring: smoothCourse(ring, true) };
};

/** A swell between `min` and `max` along a path: two sines of fixed `waves` and drawn phases. */
const swellOf = (min: number, max: number, waves: readonly [number, number], layout: SeededStream): ((u: number) => number) => {
  const p1 = layout.next() * TAU;
  const p2 = layout.next() * TAU;
  const mid = (min + max) / 2;
  const amp = (max - min) / 2;
  return (u) => mid + amp * (0.6 * Math.sin(u / waves[0] + p1) + 0.4 * Math.sin(u / waves[1] + p2));
};

/** The trunk's samples: radii swelling out of each mouth's inner radius, floors aiming at the line
 *  between the inner floors (level for a loop) with a swell, lowered where the cover needs it and to
 *  the grade; a loop's junction settled onto one floor. */
const trunkOf = (entry: MouthPlan, exit: MouthPlan | null, layout: SeededStream): Trunk => {
  let points: { x: number; z: number; u: number }[];
  let junction: [number, number] | null = null;
  if (exit) points = resample(bowCourse(entry, exit, layout));
  else {
    const { lead, ring } = loopCourse(entry, layout);
    const leadPoints = resample(lead);
    const offset = leadPoints[leadPoints.length - 1].u;
    const ringPoints = resample(ring).map((p) => ({ x: p.x, z: p.z, u: p.u + offset }));
    points = [...leadPoints, ...ringPoints.slice(1)];
    junction = [leadPoints.length - 1, points.length - 1];
  }
  const total = points[points.length - 1].u;
  const swell = swellOf(PASSAGE_RADIUS_MIN, PASSAGE_RADIUS_MAX, PASSAGE_WAVES, layout);
  const wave = layout.between(FLOOR_WAVE_MIN, FLOOR_WAVE_MAX);
  const wavePhase = layout.next() * TAU;
  const f0 = innerFloor(entry);
  const f1 = exit ? innerFloor(exit) : f0;
  const samples = points.map((p, i): PathSample => {
    const toExit = exit ? total - p.u : Infinity;
    const fromMouth = Math.min(p.u, toExit);
    const ramp = smoothstep(RADIUS_EASE_START, RADIUS_EASE_END, fromMouth);
    const r1 = toExit < p.u ? exit!.r1 : entry.r1;
    const radius = r1 + (swell(p.u) - r1) * ramp;
    const bulge = WALL_BULGE * ramp;
    const aim = f0 + (f1 - f0) * (exit ? p.u / total : 0) + FLOOR_SWELL * Math.sin((TAU * p.u) / wave + wavePhase) * smoothstep(0, FLOOR_SWELL_FADE, fromMouth);
    const side = sideAt(points, i);
    return { x: p.x, z: p.z, u: p.u, radius, bulge, bump: FLOOR_BUMP * ramp, floor: Math.min(aim, coverFloorAt(p.x, p.z, radius, bulge, side.x, side.z)) };
  });
  limitGrade(samples);
  if (junction) {
    const [a, b] = junction;
    for (let round = 0; round < LOOP_SETTLE_ROUNDS && samples[a].floor !== samples[b].floor; round++) {
      const floor = Math.min(samples[a].floor, samples[b].floor);
      samples[a].floor = floor;
      samples[b].floor = floor;
      limitGrade(samples);
    }
  }
  return { samples, junction };
};

/** A settled mouth's grade: from its opening's floor down to the trunk's floor at its inner end. */
const settledGrade = (m: MouthPlan, innerFloorY: number): number => (m.y - innerFloorY) / m.length;

// ── Branches and rooms ──────────────────────────────────────────────────

/** The unit along a path at arc length u. */
const tangentAt = (samples: readonly PathSample[], u: number): PointXZ => {
  const a = pointAt(samples, Math.max(0, u - 2));
  const b = pointAt(samples, Math.min(samples[samples.length - 1].u, u + 2));
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
};

/** How far another path's air stands from a passage's wall: the least of the other field over a ring of
 *  points on the wall, across the way (ax, az) heads. (The field saturates at FIELD_REACH, so the gap is
 *  read on the wall, never from the axis.) */
const wallGap = (others: FieldFn, x: number, axisY: number, z: number, ax: number, az: number, wall: number): number => {
  let gap = Infinity;
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    const across = Math.cos(angle) * wall;
    gap = Math.min(gap, others(x - az * across, axisY + Math.sin(angle) * wall, z + ax * across));
  }
  return gap;
};

/** One blind branch off the trunk at arc length `at`, or null when it ends shorter than BRANCH_SHORTEST.
 *  Its floor wanders within the grade under the cover; it ends where the cover falls faster than the
 *  grade, or (past the junction) where it comes within PATH_CLEARANCE of another path's air. */
const branchFrom = (trunk: readonly PathSample[], at: number, others: FieldFn, layout: SeededStream): PathSample[] | null => {
  const from = pointAt(trunk, at);
  const t = tangentAt(trunk, at);
  const turn = layout.signedUnit() * layout.between(BRANCH_TURN_MIN, BRANCH_TURN_MAX);
  const hx = t.x * Math.cos(turn) - t.z * Math.sin(turn);
  const hz = t.x * Math.sin(turn) + t.z * Math.cos(turn);
  const length = layout.between(BRANCH_LENGTH_MIN, BRANCH_LENGTH_MAX);
  const w1 = layout.between(-BRANCH_WANDER, BRANCH_WANDER) * length;
  const w2 = layout.between(-BRANCH_WANDER, BRANCH_WANDER) * length;
  const swell = swellOf(BRANCH_RADIUS_MIN, BRANCH_RADIUS_MAX, BRANCH_WAVES, layout);
  const points = resample(
    smoothCourse(
      [
        { x: from.x, z: from.z },
        { x: from.x + hx * length * 0.5 - hz * w1, z: from.z + hz * length * 0.5 + hx * w1 },
        { x: from.x + hx * length - hz * w2, z: from.z + hz * length + hx * w2 },
      ],
      false,
      { x: hx, z: hz },
    ),
  );
  const samples: PathSample[] = [{ ...from, u: 0 }];
  let cleared = false;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = samples[i - 1];
    const ramp = Math.min(1, p.u / BRANCH_EASE);
    // Written out, never through a helper: see `eased`.
    const radius = from.radius + (swell(p.u) - from.radius) * ramp * ramp * (3 - 2 * ramp);
    const bulge = eased(from.bulge, WALL_BULGE, ramp);
    const side = sideAt(points, i);
    const run = Math.hypot(p.x - prev.x, p.z - prev.z);
    const cover = coverFloorAt(p.x, p.z, radius, bulge, side.x, side.z);
    const walk = prev.floor + layout.signedUnit() * BRANCH_FLOOR_WALK * FLOOR_GRADE * run;
    if (cover < prev.floor - FLOOR_GRADE * run) break;
    const floor = Math.min(walk, cover);
    // Past the junction: once its wall has cleared the other paths' air, coming back near it ends the branch.
    const next = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
    const gap = wallGap(others, p.x, floor + AXIS_LIFT * radius, p.z, (next.x - prev.x) / len, (next.z - prev.z) / len, radius * (1 + bulge));
    if (cleared ? gap < PATH_CLEARANCE : gap >= PATH_CLEARANCE) {
      if (cleared) break;
      cleared = true;
    } else if (!cleared && p.u > 2 * (from.radius + BRANCH_EASE)) break;
    samples.push({ x: p.x, z: p.z, u: p.u, floor, radius, bulge, bump: eased(from.bump, FLOOR_BUMP, ramp) });
  }
  return samples[samples.length - 1].u < BRANCH_SHORTEST ? null : samples;
};

/** A side room centred on a path point, heading near the path's way, or null where the rock over either
 *  end or its middle is short of ROCK_COVER or it comes within PATH_CLEARANCE of another path's air. */
const roomAt = (p: PathSample, along: PointXZ, others: FieldFn, system: string, path: number, layout: SeededStream): RoomPiece | null => {
  const turn = layout.between(-ROOM_TURN, ROOM_TURN);
  const hx = along.x * Math.cos(turn) - along.z * Math.sin(turn);
  const hz = along.x * Math.sin(turn) + along.z * Math.cos(turn);
  const half = layout.between(ROOM_LENGTH_MIN, ROOM_LENGTH_MAX) / 2;
  const radius = layout.between(ROOM_RADIUS_MIN, ROOM_RADIUS_MAX);
  const ends: PointXZ[] = [
    { x: p.x - hx * half, z: p.z - hz * half },
    { x: p.x, z: p.z },
    { x: p.x + hx * half, z: p.z + hz * half },
  ];
  const wall = radius * (1 + WALL_BULGE * 0.5);
  for (const e of ends) {
    if (coverFloorAt(e.x, e.z, radius, WALL_BULGE, -hz, hx) < p.floor) return null;
    if (wallGap(others, e.x, p.floor + AXIS_LIFT * radius, e.z, hx, hz, wall) < PATH_CLEARANCE) return null;
  }
  return withBounds({ kind: "room" as const, system, path, ax: ends[0].x, ay: p.floor, az: ends[0].z, bx: ends[2].x, by: p.floor, bz: ends[2].z, radius });
};

// ── Formations ───────────────────────────────────────────────────────────

/** A stalactite or stalagmite at (x, z), from a point of the passage's air, rooted in the rock the
 *  system's field has over or under it (the real ceiling or floor, whatever piece it belongs to, so it
 *  never floats under a higher overlapping ceiling); null when there is no room for it. */
const formationAt = (field: FieldFn, x: number, startY: number, z: number, hanging: boolean, size: number, radius: number, system: string, path: number): ConePiece | null => {
  if (field(x, startY, z) >= 0) return null;
  const ceiling = probeRockAlongY(field, x, startY, z, 1, 1, 80);
  const floor = probeRockAlongY(field, x, startY, z, -1, 1, 80);
  if (Number.isNaN(ceiling) || Number.isNaN(floor)) return null;
  const room = hanging ? ceiling - floor - STALACTITE_TIP_CLEAR : ceiling - floor - STALAGMITE_CEILING_CLEAR;
  const visible = Math.min(size, room);
  if (visible < FORMATION_SHORTEST) return null;
  const dir = hanging ? -1 : 1;
  const rootY = hanging ? ceiling + FORMATION_ROOT : floor - FORMATION_ROOT;
  const length = visible + FORMATION_ROOT;
  if (field(x, rootY, z) <= 0 || field(x, rootY + dir * length, z) >= 0) return null;
  return withBounds({ kind: "cone" as const, system, path, x, y: rootY, z, length, radius, dir });
};

/** The formations along a passage, from the decoration stream: every FORMATION_STEP, clear of the mouths. */
const pathFormations = (samples: readonly PathSample[], mouthAtStart: boolean, mouthAtEnd: boolean, field: FieldFn, system: string, path: number, decor: SeededStream, out: ConePiece[]): void => {
  const total = samples[samples.length - 1].u;
  for (let u = 0; u <= total; u += FORMATION_STEP) {
    if ((mouthAtStart && u < FORMATION_MOUTH_CLEAR) || (mouthAtEnd && total - u < FORMATION_MOUTH_CLEAR)) continue;
    const p = pointAt(samples, u);
    const t = tangentAt(samples, u);
    const half = p.radius * FLOOR_HALF_WIDTH;
    const axisY = p.floor + AXIS_LIFT * p.radius;
    if (decor.next() < STALACTITE_CHANCE) {
      const l = decor.between(-STALACTITE_SPREAD, STALACTITE_SPREAD) * half;
      const size = decor.between(STALACTITE_LENGTH_MIN, STALACTITE_LENGTH_MAX);
      const radius = decor.between(STALACTITE_RADIUS_MIN, STALACTITE_RADIUS_MAX);
      const cone = formationAt(field, p.x - t.z * l, axisY, p.z + t.x * l, true, size, radius, system, path);
      if (cone) out.push(cone);
    }
    if (decor.next() < STALAGMITE_CHANCE) {
      const l = decor.signedUnit() * decor.between(STALAGMITE_WALL_MIN, STALAGMITE_WALL_MAX) * half;
      const size = decor.between(STALAGMITE_HEIGHT_MIN, STALAGMITE_HEIGHT_MAX);
      const radius = decor.between(STALAGMITE_RADIUS_MIN, STALAGMITE_RADIUS_MAX);
      const cone = half >= STALAGMITE_MIN_HALF_WIDTH ? formationAt(field, p.x - t.z * l, axisY, p.z + t.x * l, false, size, radius, system, path) : null;
      if (cone) out.push(cone);
    }
  }
};

/** A room's formations: ROOM_FORMATION_TRIES per spot along it, longer than a passage's. */
const roomFormations = (room: RoomPiece, field: FieldFn, decor: SeededStream, out: ConePiece[]): void => {
  const len = Math.hypot(room.bx - room.ax, room.bz - room.az);
  const hx = len > 0 ? (room.bx - room.ax) / len : 1;
  const hz = len > 0 ? (room.bz - room.az) / len : 0;
  const half = room.radius * FLOOR_HALF_WIDTH;
  const axisY = room.ay + AXIS_LIFT * room.radius;
  for (let s = 0; s <= len; s += FORMATION_STEP) {
    const cx = room.ax + hx * s;
    const cz = room.az + hz * s;
    for (let k = 0; k < ROOM_FORMATION_TRIES; k++) {
      if (decor.next() < STALACTITE_CHANCE) {
        const l = decor.between(-STALACTITE_SPREAD, STALACTITE_SPREAD) * half;
        const size = decor.between(STALACTITE_LENGTH_MIN, ROOM_STALACTITE_LENGTH_MAX);
        const radius = decor.between(STALACTITE_RADIUS_MIN, STALACTITE_RADIUS_MAX);
        const cone = formationAt(field, cx - hz * l, axisY, cz + hx * l, true, size, radius, room.system, room.path);
        if (cone) out.push(cone);
      }
      if (decor.next() < STALAGMITE_CHANCE) {
        const l = decor.signedUnit() * decor.between(STALAGMITE_WALL_MIN, STALAGMITE_WALL_MAX) * half;
        const size = decor.between(STALAGMITE_HEIGHT_MIN, ROOM_STALAGMITE_HEIGHT_MAX);
        const radius = decor.between(STALAGMITE_RADIUS_MIN, STALAGMITE_RADIUS_MAX);
        const cone = formationAt(field, cx - hz * l, axisY, cz + hx * l, false, size, radius, room.system, room.path);
        if (cone) out.push(cone);
      }
    }
  }
};

// ── Skirt masks ──────────────────────────────────────────────────────────

/** A path's masks: capsules over runs of MASK_RUN_SEGMENTS segments, grown to hold the run's air. */
const pathMasks = (samples: readonly PathSample[], out: SkirtMask[]): void => {
  const axisY = (s: PathSample): number => s.floor + AXIS_LIFT * s.radius;
  for (let i = 0; i < samples.length - 1; i += MASK_RUN_SEGMENTS) {
    const j = Math.min(i + MASK_RUN_SEGMENTS, samples.length - 1);
    const a = samples[i];
    const b = samples[j];
    const ay = axisY(a);
    const by = axisY(b);
    const ex = b.x - a.x;
    const ey = by - ay;
    const ez = b.z - a.z;
    const len2 = ex * ex + ey * ey + ez * ez;
    let radius = 0;
    let ceiling = -Infinity;
    for (let k = i; k <= j; k++) {
      const s = samples[k];
      const sy = axisY(s);
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((s.x - a.x) * ex + (sy - ay) * ey + (s.z - a.z) * ez) / len2)) : 0;
      const off = Math.hypot(s.x - (a.x + ex * t), sy - (ay + ey * t), s.z - (a.z + ez * t));
      radius = Math.max(radius, off + s.radius * (1 + s.bulge) + s.bump);
      ceiling = Math.max(ceiling, sy + s.radius * (1 + s.bulge));
    }
    out.push({ ax: a.x, ay, az: a.z, bx: b.x, by, bz: b.z, radius, ceiling });
  }
};

const mouthMask = (m: MouthPiece): SkirtMask => {
  const ay = m.oy + AXIS_LIFT * m.r0;
  const bx = m.ox + m.dx * m.length;
  const bz = m.oz + m.dz * m.length;
  const by = mouthFloorAt(m, m.length) + AXIS_LIFT * m.r1;
  // The axis bends where the taper starts; the straight run passes at most the lift's change from it.
  const bend = AXIS_LIFT * Math.abs(m.r0 - m.r1);
  return { ax: m.ox, ay, az: m.oz, bx, by, bz, radius: m.width + bend + 1, ceiling: ay + m.width };
};

const roomMask = (r: RoomPiece): SkirtMask => {
  const lift = AXIS_LIFT * r.radius;
  const wall = r.radius * (1 + WALL_BULGE * 0.5);
  return { ax: r.ax, ay: r.ay + lift, az: r.az, bx: r.bx, by: r.by + lift, bz: r.bz, radius: wall + FLOOR_BUMP, ceiling: r.ay + lift + wall };
};

// ── The system ───────────────────────────────────────────────────────────

const mouthPiece = (plan: MouthPlan, grade: number, id: string, system: string, phase: number): MouthPiece =>
  withBounds({
    kind: "mouth" as const,
    system,
    path: 0,
    id,
    ox: plan.x,
    oy: plan.y,
    oz: plan.z,
    dx: plan.dx,
    dz: plan.dz,
    length: plan.length,
    r0: plan.r0,
    r1: plan.r1,
    grade,
    phase,
    width: plan.r0 * (1 + MOUTH_RIM_AMP),
  });

/** One cave for a mountain cell from its site, or null where no mouth fits (or the entry settles too steep). */
export const generateCave = (key: string, biomeId: number, ix: number, iz: number, site: PointXZ, sideRooms: CaveSideRoomParams | null): TunnelSystem | null => {
  const seed = domainConfig!.seed;
  const layout = seededStream(`${seed}|${key}|layout`);
  const decor = seededStream(`${seed}|${key}|decor`);
  const entry = findEntry(site, biomeId, layout);
  if (!entry) return null;
  let exit = layout.next() < EXIT_CHANCE ? findExit(site, biomeId, entry, layout) : null;
  let trunk = trunkOf(entry.plan, exit, layout);
  let last = trunk.samples[trunk.samples.length - 1];
  // A steep exit is no way in: the cave becomes a loop.
  if (exit && settledGrade(exit, last.floor) > MOUTH_STEEP_GRADE) {
    exit = null;
    trunk = trunkOf(entry.plan, null, layout);
    last = trunk.samples[trunk.samples.length - 1];
  }
  const entryGrade = settledGrade(entry.plan, trunk.samples[0].floor);
  if (entryGrade > MOUTH_STEEP_GRADE) return null;

  const mouths: MouthPiece[] = [mouthPiece(entry.plan, entryGrade, `${key}:mouth0`, key, decor.next() * TAU)];
  if (exit) mouths.push(mouthPiece(exit, settledGrade(exit, last.floor), `${key}:mouth1`, key, decor.next() * TAU));
  const air: TunnelPiece[] = [...mouths, ...tubesOf(trunk.samples, key, 0)];

  // Blind branches, each kept off the other paths' air.
  const total = last.u;
  const branches: { samples: PathSample[]; path: number }[] = [];
  const count = layout.intBetween(BRANCH_MIN, BRANCH_MAX);
  for (let b = 0; b < count && total > 2 * BRANCH_END_CLEAR; b++) {
    const others = compileField(air, { withCones: false });
    for (let t = 0; t < BRANCH_TRIES; t++) {
      const samples = branchFrom(trunk.samples, layout.between(BRANCH_END_CLEAR, total - BRANCH_END_CLEAR), others, layout);
      if (!samples) continue;
      const path = branches.length + 1;
      branches.push({ samples, path });
      air.push(...tubesOf(samples, key, path));
      break;
    }
  }

  // Side rooms: the layout's last draws.
  const rooms: RoomPiece[] = [];
  if (sideRooms) {
    if (layout.next() < sideRooms.trunkChance) {
      const others = compileField(
        air.filter((p) => p.path !== 0),
        { withCones: false },
      );
      const hi = exit ? total - ROOM_MOUTH_CLEAR : total;
      for (let t = 0; t < ROOM_TRIES && hi > ROOM_MOUTH_CLEAR; t++) {
        const u = layout.between(ROOM_MOUTH_CLEAR, hi);
        const room = roomAt(pointAt(trunk.samples, u), tangentAt(trunk.samples, u), others, key, 0, layout);
        if (room) {
          rooms.push(room);
          break;
        }
      }
    }
    for (const branch of branches) {
      if (layout.next() >= sideRooms.tipChance) continue;
      const others = compileField(
        [...air, ...rooms].filter((p) => p.path !== branch.path),
        { withCones: false },
      );
      const tip = branch.samples[branch.samples.length - 1];
      const room = roomAt(tip, tangentAt(branch.samples, tip.u), others, key, branch.path, layout);
      if (room) rooms.push(room);
    }
  }
  air.push(...rooms);

  // Formations, from the decoration stream.
  const field = compileField(air, { withCones: false });
  const cones: ConePiece[] = [];
  pathFormations(trunk.samples, true, exit !== null, field, key, 0, decor, cones);
  for (const branch of branches) pathFormations(branch.samples, false, false, field, key, branch.path, decor, cones);
  for (const room of rooms) roomFormations(room, field, decor, cones);

  const masks: SkirtMask[] = mouths.map(mouthMask);
  pathMasks(trunk.samples, masks);
  for (const branch of branches) pathMasks(branch.samples, masks);
  for (const room of rooms) masks.push(roomMask(room));

  const pieces: TunnelPiece[] = [...air, ...cones];
  const bounds = emptyBounds();
  for (const p of pieces) growBounds(bounds, p.bounds);
  return { key, style: "cave", biomeId, ix, iz, pieces, mouths, entrances: [], masks, bounds };
};

// ── Mouth rocks ──────────────────────────────────────────────────────────

const spotCache = new WeakMap<MouthPiece, RockSpot[]>();

/** Where the rock dressing stands a mouth's rocks, on the BULGED ground (asked after generation), from
 *  one stream: candidates scattered over a rectangle about the opening, never in the opening, every RIM
 *  point (a neighbour MOUTH_ROCK_GRID away is in it) kept and set back outward, any other kept at
 *  MOUTH_ROCK_FAR_KEEP; none on the passage floor or the approach, all spaced. Remembered per piece. */
export const mouthSpots = (m: MouthPiece): RockSpot[] => {
  const known = spotCache.get(m);
  if (known) return known;
  const stream = seededStream(`${domainConfig!.seed}|${m.id}|rocks`);
  const reach = MOUTH_ROCK_REACH_RADII * m.r0;
  const across = Math.max(reach, m.width + MOUTH_ROCK_SIDE_PAD);
  const front = -MOUTH_ROCK_FRONT_SHARE * reach;
  const back = Math.max(reach, m.length);
  const worldX = (a: number, l: number): number => m.ox + m.dx * a - m.dz * l;
  const worldZ = (a: number, l: number): number => m.oz + m.dz * a + m.dx * l;
  const inside = (a: number, l: number): boolean => {
    const x = worldX(a, l);
    const z = worldZ(a, l);
    return insideMouthOpening(m, x, groundAt(x, z), z);
  };
  const spots: RockSpot[] = [];
  const count = stream.intBetween(MOUTH_ROCK_COUNT_MIN, MOUTH_ROCK_COUNT_MAX);
  for (let n = 0; n < count; n++) {
    for (let t = 0; t < MOUTH_ROCK_TRIES; t++) {
      let a = stream.between(front, back);
      let l = stream.between(-across, across);
      const u = stream.next();
      const size = MOUTH_ROCK_SIZE_MIN + (MOUTH_ROCK_SIZE_MAX - MOUTH_ROCK_SIZE_MIN) * u * u * u;
      if (inside(a, l)) continue;
      const g = MOUTH_ROCK_GRID;
      const rim = inside(a + g, l) || inside(a - g, l) || inside(a, l + g) || inside(a, l - g);
      if (!rim && stream.next() >= MOUTH_ROCK_FAR_KEEP) continue;
      if (a >= 0 && a <= m.length && groundAt(worldX(a, l), worldZ(a, l)) - mouthFloorAt(m, a) < MOUTH_ROCK_RISE) continue;
      if (a < MOUTH_ROCK_APPROACH_IN * m.r0 && Math.abs(l) < m.r0 + size + MOUTH_ROCK_APPROACH_PAD) continue;
      if (rim) {
        const setback = MOUTH_ROCK_SETBACK * size;
        if (a < 0) a -= setback;
        else l += l < 0 ? -setback : setback;
        if (inside(a, l)) continue;
      }
      const x = worldX(a, l);
      const z = worldZ(a, l);
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < s.size + size + MOUTH_ROCK_SPACING_PAD)) continue;
      spots.push({ x, z, size });
      break;
    }
  }
  spotCache.set(m, spots);
  return spots;
};
