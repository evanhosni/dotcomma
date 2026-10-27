/**
 * The cave generator: one system per cell of a biome whose spec mounts <Caves> that passes its roll (systems.ts). It
 * reads the terrain through computeVertexData only, while the bulge is held off (generatingTunnels),
 * and draws its layout and its decoration from two seeded streams, so decoration never moves a
 * passage. Three-free.
 */

import { smoothstep } from "../../math/_math";
import { seededStream, type SeededStream } from "../../math/seededStream";
import type { PointXZ } from "../../math/types";
import type { CaveSideRoomParams } from "../types";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../rivers/constants";
import { riverFlowSpeed } from "../rivers/riverField";
import { computeVertexData, outsideBiomes } from "../vertexCompute";
import {
  AXIS_LIFT,
  BRANCH_AIR_CLEAR,
  BRANCH_CONTROL_POINTS,
  BRANCH_COUNT_MAX,
  BRANCH_COUNT_MIN,
  BRANCH_EASE,
  BRANCH_END_CLEAR,
  BRANCH_FLOOR_WALK,
  BRANCH_LENGTH_MAX,
  BRANCH_LENGTH_MIN,
  BRANCH_MIN_LENGTH,
  BRANCH_RADIUS_MAX,
  BRANCH_RADIUS_MIN,
  BRANCH_TRIES,
  BRANCH_TURN_MAX,
  BRANCH_TURN_MIN,
  BRANCH_WANDER,
  BRANCH_WAVES,
  CLIMB_GRADE_HALF_RUN,
  CLIMB_GRADE_MAX,
  COVER_FLANK_PAD,
  ENTRY_DIRECTIONS,
  EXIT_ANGLE_WANDER,
  EXIT_CHANCE,
  EXIT_MIN_DISTANCE,
  EXIT_TRIES,
  FLOOR_BUMP,
  FLOOR_GRADE,
  FLOOR_HALF_WIDTH,
  FLOOR_SWELL,
  FLOOR_SWELL_RAMP,
  FLOOR_SWELL_WAVE_MAX,
  FLOOR_SWELL_WAVE_MIN,
  FORMATION_MIN_LENGTH,
  FORMATION_PROBE_LIFT,
  FORMATION_PROBE_MAX,
  FORMATION_PROBE_STEP,
  FORMATION_ROOT,
  FORMATION_STEP,
  HIGH_MOUTH_CHANCE,
  HIGH_MOUTH_CLIMB_MAX,
  HIGH_MOUTH_RISE_MAX,
  HIGH_MOUTH_RISE_MIN,
  JUNCTION_SETTLE_PASSES,
  LOOP_AIM,
  LOOP_JITTER,
  LOOP_LEAD_MAX,
  LOOP_LEAD_MIN,
  LOOP_POINTS,
  LOOP_RADIUS_MAX,
  LOOP_RADIUS_MIN,
  MASK_RUN,
  MOUTH_BACK_MAX,
  MOUTH_BACK_STEP,
  MOUTH_CLIMB_GRADE,
  MOUTH_CLIMB_RUN,
  MOUTH_RAMP_END,
  MOUTH_RAMP_START,
  MOUTH_RIM_AMP,
  MOUTH_ROAD_CLEAR,
  MOUTH_SEARCH_MAX,
  MOUTH_SEARCH_STEP,
  MOUTH_SITE_CLEAR,
  MOUTH_STEEP_GRADE,
  MOUTH_WATER_CLEAR,
  OPENING_RADIUS_MAX,
  OPENING_RADIUS_MIN,
  PASSAGE_RADIUS_MAX,
  PASSAGE_RADIUS_MIN,
  PASSAGE_SWELL_MAX,
  PASSAGE_SWELL_MIN,
  PASSAGE_WAVES,
  PASSAGE_WAVE_WEIGHTS,
  PATH_STEP,
  RIM_FRONT,
  RIM_GRID,
  RIM_ROCK_CHANCE,
  RIM_ROCK_RISE,
  RIM_ROCK_SETBACK,
  RIM_ROCK_SIZE_MAX,
  RIM_ROCK_SIZE_MIN,
  RIM_ROCK_SPACING,
  RIM_SIDE_PAD,
  ROCK_COVER,
  ROOM_AIR_CLEAR,
  ROOM_FORMATION_TRIES,
  ROOM_HEADING,
  ROOM_LENGTH_MAX,
  ROOM_LENGTH_MIN,
  ROOM_MOUTH_CLEAR,
  ROOM_RADIUS_MAX,
  ROOM_RADIUS_MIN,
  ROOM_TRIES,
  SECTION_GRADE,
  SECTION_MAX,
  SECTION_MIN,
  SECTION_STEP,
  STALACTITE_CHANCE,
  STALACTITE_HEADROOM,
  STALACTITE_LENGTH_MAX,
  STALACTITE_LENGTH_MIN,
  STALACTITE_RADIUS_MAX,
  STALACTITE_RADIUS_MIN,
  STALACTITE_ROOM_LENGTH,
  STALACTITE_SPREAD,
  STALAGMITE_CEILING_CLEAR,
  STALAGMITE_CHANCE,
  STALAGMITE_HEIGHT_MAX,
  STALAGMITE_HEIGHT_MIN,
  STALAGMITE_MIN_HALF_WIDTH,
  STALAGMITE_PLACE_MAX,
  STALAGMITE_PLACE_MIN,
  STALAGMITE_RADIUS_MAX,
  STALAGMITE_RADIUS_MIN,
  STALAGMITE_ROOM_HEIGHT,
  STREWN_APPROACH_IN,
  STREWN_APPROACH_PAD,
  STREWN_FRONT_SHARE,
  STREWN_MAX,
  STREWN_MIN,
  STREWN_REACH_RADII,
  STREWN_SIZE_MAX,
  STREWN_SIZE_MIN,
  STREWN_SPACING_PAD,
  STREWN_TRIES,
  SPRING_HALL_DEPTH,
  SPRING_HALL_RADIUS,
  SPRING_LEAD,
  SPRING_OPENING_MAX,
  SPRING_OPENING_PAD,
  SPRING_POOL_DEPTH,
  SPRING_ROOM_LENGTH,
  SPRING_ROOM_RADIUS,
  SPRING_ROOM_RADIUS_MIN,
  SPRING_STRIP_DEPTH,
  SPRING_SECTION_GRADE,
  SPRING_SHARE_REACH,
  SPRING_SINK,
  SPRING_WATER_BELOW_SURFACE,
  TRUNK_LEAD,
  TRUNK_WANDER,
  WALL_BULGE,
} from "./constants";
import type { SpringSite } from "./springs";
import { perpendicular, rotated, sampleCurve, tangentAt } from "./paths";
import { compileField, emptyBounds, growBounds, insideMouthOpening, mouthAlong, mouthLateral, probeRockAlongY, withBounds, type FieldFn } from "./tunnelField";
import type { ConePiece, MouthPiece, RockSpot, RoomPiece, SkirtMask, TubePiece, TunnelEntrance, TunnelPiece, TunnelSystem, SpringWater } from "./types";

const heightAt = (x: number, z: number): number => computeVertexData(x, z).height;

/** A bulged tube's crown over its floor, in radii. */
const CROWN_OVER_FLOOR = 1 + AXIS_LIFT + WALL_BULGE;

/** The highest floor at (x, z) keeping ROCK_COVER over a passage of radius r, judged on its axis and on
 *  both flanks (`side`: the unit normal of its path), COVER_FLANK_PAD past the bulged wall. */
const coverCap = (x: number, z: number, sideX: number, sideZ: number, r: number): number => {
  const flank = r * (1 + WALL_BULGE) + COVER_FLANK_PAD;
  return Math.min(heightAt(x, z), heightAt(x + sideX * flank, z + sideZ * flank), heightAt(x - sideX * flank, z - sideZ * flank)) - ROCK_COVER - CROWN_OVER_FLOOR * r;
};

/** Unfit ground for a mouth: water, a river's keep-off, a deck, a road. */
const unfitAt = (x: number, z: number): boolean => {
  const vd = computeVertexData(x, z);
  const city = domainConfig!.cityConfig;
  return (
    vd.waterHeight > vd.height - MOUTH_WATER_CLEAR ||
    vd.distanceToRiverCenter < riverKeepOff() ||
    vd.underDeck > 0 ||
    vd.distanceToRoadCenter < city.roadWidth + MOUTH_ROAD_CLEAR ||
    vd.distanceToFreewayCenter < city.freewayWidth + MOUTH_ROAD_CLEAR
  );
};

// ── Mouths ────────────────────────────────────────────────────────────────

interface MouthFoot {
  x: number;
  z: number;
  /** Unit direction into the mountain. */
  dx: number;
  dz: number;
}

/** Walks from the site out along `angle` until the ground leaves the biome, then back in to the first
 *  spot where the ground climbs into the mountain; null when there is no such spot. */
const findFoot = (site: PointXZ, angle: number, biomeId: number): MouthFoot | null => {
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  let out = -1;
  for (let s = MOUTH_SEARCH_STEP; s <= MOUTH_SEARCH_MAX; s += MOUTH_SEARCH_STEP) {
    if (outsideBiomes([biomeId], site.x + ux * s, site.z + uz * s)) {
      out = s;
      break;
    }
  }
  if (out < 0) return null;
  const dx = -ux;
  const dz = -uz;
  for (let back = MOUTH_BACK_STEP; back <= MOUTH_BACK_MAX; back += MOUTH_BACK_STEP) {
    const a = out - back;
    if (a < MOUTH_SITE_CLEAR) break;
    const x = site.x + ux * a;
    const z = site.z + uz * a;
    const rise = heightAt(x + dx * MOUTH_CLIMB_RUN, z + dz * MOUTH_CLIMB_RUN) - heightAt(x, z);
    if (rise < MOUTH_CLIMB_GRADE * MOUTH_CLIMB_RUN) continue;
    if (unfitAt(x, z)) continue;
    return { x, z, dx, dz };
  }
  return null;
};

/** The spots up the ray from the foot where a HIGH mouth may open: the first `target` over the foot,
 *  each with a local grade of at most CLIMB_GRADE_MAX and fit ground. */
const climbSpots = (foot: MouthFoot, target: number): MouthFoot[] => {
  const out: MouthFoot[] = [];
  const base = heightAt(foot.x, foot.z);
  for (let s = MOUTH_BACK_STEP; s <= HIGH_MOUTH_CLIMB_MAX; s += MOUTH_BACK_STEP) {
    const x = foot.x + foot.dx * s;
    const z = foot.z + foot.dz * s;
    if (heightAt(x, z) - base < target) continue;
    const grade =
      Math.abs(heightAt(x + foot.dx * CLIMB_GRADE_HALF_RUN, z + foot.dz * CLIMB_GRADE_HALF_RUN) - heightAt(x - foot.dx * CLIMB_GRADE_HALF_RUN, z - foot.dz * CLIMB_GRADE_HALF_RUN)) /
      (2 * CLIMB_GRADE_HALF_RUN);
    if (grade > CLIMB_GRADE_MAX || unfitAt(x, z)) continue;
    out.push({ x, z, dx: foot.dx, dz: foot.dz });
  }
  return out;
};

/** The shortest section (descending at SECTION_GRADE) that keeps ROCK_COVER over the passage's crown
 *  at its inner end (on the axis and on both flanks), with fit ground all along it; NaN when none does. */
const settleSection = (foot: MouthFoot, oy: number, r1: number): number => {
  const px = -foot.dz;
  const pz = foot.dx;
  for (let length = SECTION_MIN; length <= SECTION_MAX; length += SECTION_STEP) {
    if (unfitAt(foot.x + foot.dx * length, foot.z + foot.dz * length)) return NaN;
    if (coverCap(foot.x + foot.dx * length, foot.z + foot.dz * length, px, pz, r1) >= oy - SECTION_GRADE * length) return length;
  }
  return NaN;
};

/** A mouth at `foot` (or, climbing, at the first high spot whose section settles; otherwise back at
 *  the foot): null when no section keeps its cover. */
const planMouth = (system: string, id: string, foot: MouthFoot, climb: number, r0: number, r1: number, phase: number): MouthPiece | null => {
  const spots = climb > 0 ? climbSpots(foot, climb) : [];
  spots.push(foot);
  for (const at of spots) {
    const oy = heightAt(at.x, at.z);
    const length = settleSection(at, oy, r1);
    if (Number.isNaN(length)) continue;
    return withBounds({ kind: "mouth" as const, system, path: 0, id, ox: at.x, oy, oz: at.z, dx: at.dx, dz: at.dz, length, r0, r1, grade: SECTION_GRADE, phase, width: r0 * (1 + MOUTH_RIM_AMP), spots: [] });
  }
  return null;
};

/** The entry: the first of ENTRY_DIRECTIONS directions from a random base angle whose mouth fits
 *  (HIGH_MOUTH_CHANCE of them climbing HIGH_MOUTH_RISE_MIN–MAX up the ray first). */
const findEntry = (key: string, site: PointXZ, biomeId: number, layout: SeededStream, decor: SeededStream): { entry: MouthPiece; angle: number } | null => {
  const base = layout.next() * Math.PI * 2;
  const climb = layout.next() < HIGH_MOUTH_CHANCE ? layout.between(HIGH_MOUTH_RISE_MIN, HIGH_MOUTH_RISE_MAX) : 0;
  for (let k = 0; k < ENTRY_DIRECTIONS; k++) {
    const angle = base + (k * 2 * Math.PI) / ENTRY_DIRECTIONS;
    const foot = findFoot(site, angle, biomeId);
    if (!foot) continue;
    const r0 = layout.between(OPENING_RADIUS_MIN, OPENING_RADIUS_MAX);
    const r1 = layout.between(PASSAGE_RADIUS_MIN, PASSAGE_RADIUS_MAX);
    const entry = planMouth(key, `${key}:mouth0`, foot, climb, r0, r1, decor.next() * Math.PI * 2);
    if (entry) return { entry, angle };
  }
  return null;
};

/** The exit, opposite the entry (EXIT_ANGLE_WANDER either way), at the foot, at least EXIT_MIN_DISTANCE
 *  from the entry's opening; EXIT_TRIES attempts, EXIT_CHANCE of trying at all. */
const findExit = (key: string, site: PointXZ, biomeId: number, entry: MouthPiece, entryAngle: number, layout: SeededStream, decor: SeededStream): MouthPiece | null => {
  if (layout.next() >= EXIT_CHANCE) return null;
  for (let t = 0; t < EXIT_TRIES; t++) {
    const angle = entryAngle + Math.PI + layout.between(-EXIT_ANGLE_WANDER, EXIT_ANGLE_WANDER);
    const foot = findFoot(site, angle, biomeId);
    if (!foot || Math.hypot(foot.x - entry.ox, foot.z - entry.oz) < EXIT_MIN_DISTANCE) continue;
    const r0 = layout.between(OPENING_RADIUS_MIN, OPENING_RADIUS_MAX);
    const r1 = layout.between(PASSAGE_RADIUS_MIN, PASSAGE_RADIUS_MAX);
    const exit = planMouth(key, `${key}:mouth1`, foot, 0, r0, r1, decor.next() * Math.PI * 2);
    if (exit) return exit;
  }
  return null;
};

/** The mouth with its section's grade settled from the trunk's floor at its inner end, so the entry
 *  and the first tube always meet. */
const settledMouth = (m: MouthPiece, innerFloor: number): MouthPiece => {
  const { bounds: _bounds, ...rest } = m;
  return withBounds({ ...rest, grade: (m.oy - innerFloor) / m.length });
};

/** Whether a section settled on `innerFloor` would be steeper than MOUTH_STEEP_GRADE: no way in. */
const sectionTooSteep = (m: MouthPiece, innerFloor: number): boolean => Math.abs(m.oy - innerFloor) / m.length > MOUTH_STEEP_GRADE;

/** A mouth's inner end: the floor point where the passage begins. */
const innerEnd = (m: MouthPiece): { x: number; y: number; z: number } => ({
  x: m.ox + m.dx * m.length,
  y: m.oy - m.grade * m.length,
  z: m.oz + m.dz * m.length,
});

// ── Paths ─────────────────────────────────────────────────────────────────

interface PathSample {
  x: number;
  z: number;
  floor: number;
  r: number;
  /** Fraction of the radius; 0 at a mouth's inner end, WALL_BULGE past the ramp. */
  bulge: number;
  bump: number;
  /** Distance along the path to the nearest mouth's inner end (Infinity on a mouthless path). */
  mouthDist: number;
}

interface CavePath {
  index: number;
  samples: PathSample[];
  closed: boolean;
}

const pathXZ = (path: CavePath): PointXZ[] => path.samples.map((s) => ({ x: s.x, z: s.z }));

/** The passage radius swell at `s` along a path: between min and max by two sines. */
const swellAt = (s: number, min: number, max: number, waves: readonly number[], phases: readonly number[]): number => {
  const mid = (min + max) / 2;
  const amp = (max - min) / 2;
  return mid + amp * (PASSAGE_WAVE_WEIGHTS[0] * Math.sin(s / waves[0] + phases[0]) + PASSAGE_WAVE_WEIGHTS[1] * Math.sin(s / waves[1] + phases[1]));
};

/** Lowers floors so no step climbs or falls faster than the grade over its own run (only ever lowers). */
const relaxGrade = (samples: PathSample[]): void => {
  const n = samples.length;
  const run = (i: number, j: number): number => FLOOR_GRADE * Math.hypot(samples[j].x - samples[i].x, samples[j].z - samples[i].z);
  for (let i = 1; i < n; i++) samples[i].floor = Math.min(samples[i].floor, samples[i - 1].floor + run(i - 1, i));
  for (let i = n - 2; i >= 0; i--) samples[i].floor = Math.min(samples[i].floor, samples[i + 1].floor + run(i, i + 1));
};

/** The trunk's course between the entry's inner end and the exit's: a smooth bow through a straight
 *  lead from each mouth and TRUNK_WANDER sideways at the quarter points, sampled every PATH_STEP. */
const bowCourse = (entry: MouthPiece, exit: MouthPiece, layout: SeededStream): PointXZ[] => {
  const a = innerEnd(entry);
  const b = innerEnd(exit);
  const p1 = { x: a.x + entry.dx * TRUNK_LEAD, z: a.z + entry.dz * TRUNK_LEAD };
  const q1 = { x: b.x + exit.dx * TRUNK_LEAD, z: b.z + exit.dz * TRUNK_LEAD };
  const chord = { x: q1.x - p1.x, z: q1.z - p1.z };
  const len = Math.hypot(chord.x, chord.z) || 1;
  const side = perpendicular({ x: chord.x / len, z: chord.z / len });
  const sign = layout.signedUnit();
  const points: PointXZ[] = [{ x: a.x, z: a.z }, p1];
  TRUNK_WANDER.forEach((w, k) => {
    const t = (k + 1) / (TRUNK_WANDER.length + 1);
    points.push({ x: p1.x + chord.x * t + side.x * w * sign, z: p1.z + chord.z * t + side.z * w * sign });
  });
  points.push(q1, { x: b.x, z: b.z });
  return sampleCurve(points, false, PATH_STEP);
};

/** The trunk's course without an exit: a straight lead from the entry's inner end to a junction, then a
 *  jittered ring of LOOP_POINTS around a center beside it, back to the junction (visited twice). */
const loopCourse = (entry: MouthPiece, layout: SeededStream): { xz: PointXZ[]; junctionIndex: number } => {
  const a = innerEnd(entry);
  const lead = layout.between(LOOP_LEAD_MIN, LOOP_LEAD_MAX);
  const j = { x: a.x + entry.dx * lead, z: a.z + entry.dz * lead };
  const R = layout.between(LOOP_RADIUS_MIN, LOOP_RADIUS_MAX);
  const turn = layout.signedUnit();
  const aim = layout.between(-LOOP_AIM, LOOP_AIM);
  const toCenter = rotated({ x: entry.dx, z: entry.dz }, turn * (Math.PI / 2) + aim);
  const c = { x: j.x + toCenter.x * R, z: j.z + toCenter.z * R };
  const start = Math.atan2(j.z - c.z, j.x - c.x);
  const ring: PointXZ[] = [];
  for (let k = 0; k < LOOP_POINTS; k++) {
    const ang = start - turn * ((k * 2 * Math.PI) / LOOP_POINTS);
    const rk = k === 0 ? R : R * (1 + layout.between(-LOOP_JITTER, LOOP_JITTER));
    ring.push({ x: c.x + Math.cos(ang) * rk, z: c.z + Math.sin(ang) * rk });
  }
  const leadSamples = sampleCurve([{ x: a.x, z: a.z }, { x: j.x, z: j.z }], false, PATH_STEP);
  const ringSamples = sampleCurve(ring, true, PATH_STEP);
  return { xz: leadSamples.concat(ringSamples.slice(1)), junctionIndex: leadSamples.length - 1 };
};

/** The junction of a loop is visited twice, on one floor (the lower of the two keeps the cover);
 *  lowering one visit can break the grade beside it, so the two settle together (floors only ever go
 *  down). */
const settleJunction = (samples: PathSample[], junctionIndex: number): void => {
  const last = samples.length - 1;
  for (let pass = 0; pass < JUNCTION_SETTLE_PASSES && samples[junctionIndex].floor !== samples[last].floor; pass++) {
    const floor = Math.min(samples[junctionIndex].floor, samples[last].floor);
    samples[junctionIndex].floor = floor;
    samples[last].floor = floor;
    relaxGrade(samples);
  }
};

/** The trunk between the entry's inner end and the exit's (a smooth bow), or from the entry to a
 *  closed ring without an exit. Samples every PATH_STEP with radius, floor, bulge and bumps: floors
 *  aim at the line between the inner ends, swelling a little, and dip only where the cover demands. */
const buildTrunk = (entry: MouthPiece, exit: MouthPiece | null, layout: SeededStream): CavePath => {
  const a = innerEnd(entry);
  let xz: PointXZ[];
  let junctionIndex = -1;
  if (exit) xz = bowCourse(entry, exit, layout);
  else ({ xz, junctionIndex } = loopCourse(entry, layout));
  const phases = [layout.next() * Math.PI * 2, layout.next() * Math.PI * 2];
  const swellPhase = layout.next() * Math.PI * 2;
  const swellWave = layout.between(FLOOR_SWELL_WAVE_MIN, FLOOR_SWELL_WAVE_MAX);
  const total = (xz.length - 1) * PATH_STEP;
  const samples: PathSample[] = xz.map((p, i) => {
    const s = i * PATH_STEP;
    const fromEntry = s;
    const fromExit = exit ? total - s : Infinity;
    const mouthDist = Math.min(fromEntry, fromExit);
    const ramp = smoothstep(MOUTH_RAMP_START, MOUTH_RAMP_END, mouthDist);
    const r1 = fromExit < fromEntry ? exit!.r1 : entry.r1;
    const r = r1 + (swellAt(s, PASSAGE_SWELL_MIN, PASSAGE_SWELL_MAX, PASSAGE_WAVES, phases) - r1) * ramp;
    const target = exit ? a.y + (innerEnd(exit).y - a.y) * (s / total) : a.y;
    const swell = FLOOR_SWELL * Math.sin((2 * Math.PI * s) / swellWave + swellPhase) * Math.min(1, mouthDist / FLOOR_SWELL_RAMP);
    const side = perpendicular(tangentAt(xz, i));
    const floor = Math.min(target + swell, coverCap(p.x, p.z, side.x, side.z, r));
    return { x: p.x, z: p.z, floor, r, bulge: WALL_BULGE * ramp, bump: FLOOR_BUMP * ramp, mouthDist };
  });
  relaxGrade(samples);
  if (junctionIndex >= 0) settleJunction(samples, junctionIndex);
  return { index: 0, samples, closed: false };
};

/** Whether a passage sample comes within `clear` of another path's air. */
const nearOtherAir = (x: number, z: number, floor: number, r: number, paths: readonly CavePath[], own: number, clear: number): boolean => {
  for (const path of paths) {
    if (path.index === own) continue;
    for (const s of path.samples) {
      const d = Math.hypot(s.x - x, s.z - z, s.floor - floor);
      if (d - (s.r + r) < clear) return true;
    }
  }
  return false;
};

/** One branch off the trunk at sample `i`, turned by `turn`: a wandering curve of `length`, its radius
 *  easing from the trunk's into its own swell, its floor a random walk under the cover; cut short where
 *  the cover drops faster than the grade or it comes near another path's air. Null when too short. */
const walkBranch = (trunk: CavePath, i: number, turn: number, length: number, others: readonly CavePath[], index: number, layout: SeededStream): CavePath | null => {
  const from = trunk.samples[i];
  const dir = rotated(tangentAt(pathXZ(trunk), i), turn);
  const side = perpendicular(dir);
  const points: PointXZ[] = [{ x: from.x, z: from.z }];
  for (let k = 1; k <= BRANCH_CONTROL_POINTS; k++) {
    const t = k / BRANCH_CONTROL_POINTS;
    const w = layout.between(-BRANCH_WANDER, BRANCH_WANDER) * length;
    points.push({ x: from.x + dir.x * length * t + side.x * w, z: from.z + dir.z * length * t + side.z * w });
  }
  const phases = [layout.next() * Math.PI * 2, layout.next() * Math.PI * 2];
  const xz = sampleCurve(points, false, PATH_STEP);
  const samples: PathSample[] = [];
  const junctionClear = from.r + BRANCH_RADIUS_MAX + BRANCH_AIR_CLEAR;
  for (let k = 0; k < xz.length; k++) {
    const s = k * PATH_STEP;
    const ramp = Math.min(1, s / BRANCH_EASE);
    const swell = swellAt(s, BRANCH_RADIUS_MIN, BRANCH_RADIUS_MAX, BRANCH_WAVES, phases);
    // The ramp written out: this exact order of products is what every branch radius is.
    const r = from.r + (swell - from.r) * ramp * ramp * (3 - 2 * ramp);
    const run = k === 0 ? 0 : Math.hypot(xz[k].x - xz[k - 1].x, xz[k].z - xz[k - 1].z);
    let floor = k === 0 ? from.floor : samples[k - 1].floor + layout.signedUnit() * BRANCH_FLOOR_WALK * FLOOR_GRADE * run;
    const flank = perpendicular(tangentAt(xz, k));
    const cap = coverCap(xz[k].x, xz[k].z, flank.x, flank.z, r);
    if (floor > cap) {
      if (k > 0 && cap < samples[k - 1].floor - FLOOR_GRADE * run) break;
      floor = cap;
    }
    if (s > junctionClear && nearOtherAir(xz[k].x, xz[k].z, floor, r, others, index, BRANCH_AIR_CLEAR)) break;
    samples.push({ x: xz[k].x, z: xz[k].z, floor, r, bulge: WALL_BULGE, bump: FLOOR_BUMP, mouthDist: Infinity });
  }
  if ((samples.length - 1) * PATH_STEP < BRANCH_MIN_LENGTH) return null;
  return { index, samples, closed: false };
};

/** BRANCH_COUNT_MIN–MAX blind branches from random trunk samples clear of its ends, BRANCH_TRIES each. */
const buildBranches = (trunk: CavePath, layout: SeededStream): CavePath[] => {
  const branches: CavePath[] = [];
  const count = layout.intBetween(BRANCH_COUNT_MIN, BRANCH_COUNT_MAX);
  const n = trunk.samples.length;
  const endClear = Math.ceil(BRANCH_END_CLEAR / PATH_STEP);
  for (let b = 0; b < count; b++) {
    for (let attempt = 0; attempt < BRANCH_TRIES; attempt++) {
      if (n - 2 * endClear <= 1) break;
      const i = layout.intBetween(endClear, n - 1 - endClear);
      const turn = layout.signedUnit() * layout.between(BRANCH_TURN_MIN, BRANCH_TURN_MAX);
      const length = layout.between(BRANCH_LENGTH_MIN, BRANCH_LENGTH_MAX);
      const branch = walkBranch(trunk, i, turn, length, [trunk, ...branches], branches.length + 1, layout);
      if (!branch) continue;
      branches.push(branch);
      break;
    }
  }
  return branches;
};

// ── Rooms ─────────────────────────────────────────────────────────────────

interface Room {
  piece: RoomPiece;
  path: number;
  floor: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

const tryRoom = (system: string, path: CavePath, i: number, paths: readonly CavePath[], layout: SeededStream): Room | null => {
  const s = path.samples[i];
  const R = layout.between(ROOM_RADIUS_MIN, ROOM_RADIUS_MAX);
  const L = layout.between(ROOM_LENGTH_MIN, ROOM_LENGTH_MAX);
  const heading = rotated(tangentAt(pathXZ(path), i), layout.between(-ROOM_HEADING, ROOM_HEADING));
  const ax = s.x - (heading.x * L) / 2;
  const az = s.z - (heading.z * L) / 2;
  const bx = s.x + (heading.x * L) / 2;
  const bz = s.z + (heading.z * L) / 2;
  const floor = s.floor;
  for (const [x, z] of [
    [ax, az],
    [s.x, s.z],
    [bx, bz],
  ])
    if (coverCap(x, z, -heading.z, heading.x, R) < floor) return null;
  if (nearOtherAir(s.x, s.z, floor, R, paths, path.index, ROOM_AIR_CLEAR)) return null;
  const piece = withBounds({ kind: "room" as const, system, path: path.index, ax, ay: floor, az, bx, by: floor, bz, radius: R });
  return { piece, path: path.index, floor, ax, az, bx, bz };
};

/** One room on the trunk (`trunkChance`, clear of the mouths) and one at each branch tip (`tipChance`). */
const buildRooms = (system: string, trunk: CavePath, branches: readonly CavePath[], layout: SeededStream, chances: CaveSideRoomParams): Room[] => {
  const rooms: Room[] = [];
  const paths = [trunk, ...branches];
  if (layout.next() < chances.trunkChance) {
    const candidates = trunk.samples.map((s, i) => i).filter((i) => trunk.samples[i].mouthDist >= ROOM_MOUTH_CLEAR);
    for (let t = 0; t < ROOM_TRIES && candidates.length > 0; t++) {
      const room = tryRoom(system, trunk, layout.pick(candidates), paths, layout);
      if (room) {
        rooms.push(room);
        break;
      }
    }
  }
  for (const branch of branches) {
    if (layout.next() >= chances.tipChance) continue;
    const room = tryRoom(system, branch, branch.samples.length - 1, paths, layout);
    if (room) rooms.push(room);
  }
  return rooms;
};

// ── Formations ────────────────────────────────────────────────────────────

/** The rock above (dir +1) or below (−1) a point of the system's air; NaN when the point is in rock or
 *  none lies within FORMATION_PROBE_MAX. */
const probeRock = (field: FieldFn, x: number, y0: number, z: number, dir: 1 | -1): number =>
  field(x, y0, z) >= 0 ? NaN : probeRockAlongY(field, x, y0, z, dir, FORMATION_PROBE_STEP, FORMATION_PROBE_MAX);

interface FormationSpot {
  x: number;
  z: number;
  floor: number;
  halfWidth: number;
  /** Left-hand perpendicular of the path there. */
  px: number;
  pz: number;
  room: boolean;
}

/** The stalactite and stalagmite a spot may get (a room tries ROOM_FORMATION_TRIES times), each rooted
 *  FORMATION_ROOT into the rock the probe finds from FORMATION_PROBE_LIFT over the floor. */
const formationCones = (system: string, field: FieldFn, spot: FormationSpot, decor: SeededStream): ConePiece[] => {
  const out: ConePiece[] = [];
  const tries = spot.room ? ROOM_FORMATION_TRIES : 1;
  for (let t = 0; t < tries; t++) {
    if (decor.next() < STALACTITE_CHANCE) {
      const lateral = decor.signedUnit() * decor.next() * STALACTITE_SPREAD * spot.halfWidth;
      const x = spot.x + spot.px * lateral;
      const z = spot.z + spot.pz * lateral;
      const length = spot.room ? decor.between(STALACTITE_LENGTH_MIN, STALACTITE_ROOM_LENGTH) : decor.between(STALACTITE_LENGTH_MIN, STALACTITE_LENGTH_MAX);
      const radius = decor.between(STALACTITE_RADIUS_MIN, STALACTITE_RADIUS_MAX);
      const ceiling = probeRock(field, x, spot.floor + FORMATION_PROBE_LIFT, z, 1);
      if (!Number.isNaN(ceiling)) {
        const tip = Math.max(ceiling - length, spot.floor + STALACTITE_HEADROOM);
        if (ceiling - tip >= FORMATION_MIN_LENGTH) {
          out.push(withBounds({ kind: "cone" as const, system, path: 0, x, y: ceiling + FORMATION_ROOT, z, length: ceiling + FORMATION_ROOT - tip, radius, dir: -1 as const }));
        }
      }
    }
    if (spot.halfWidth >= STALAGMITE_MIN_HALF_WIDTH && decor.next() < STALAGMITE_CHANCE) {
      const lateral = decor.signedUnit() * decor.between(STALAGMITE_PLACE_MIN, STALAGMITE_PLACE_MAX) * spot.halfWidth;
      const x = spot.x + spot.px * lateral;
      const z = spot.z + spot.pz * lateral;
      const height = spot.room ? decor.between(STALAGMITE_HEIGHT_MIN, STALAGMITE_ROOM_HEIGHT) : decor.between(STALAGMITE_HEIGHT_MIN, STALAGMITE_HEIGHT_MAX);
      const radius = decor.between(STALAGMITE_RADIUS_MIN, STALAGMITE_RADIUS_MAX);
      const rock = probeRock(field, x, spot.floor + FORMATION_PROBE_LIFT, z, -1);
      const ceiling = probeRock(field, x, spot.floor + FORMATION_PROBE_LIFT, z, 1);
      if (!Number.isNaN(rock) && !Number.isNaN(ceiling)) {
        const tip = Math.min(rock + height, ceiling - STALAGMITE_CEILING_CLEAR);
        if (tip - rock >= FORMATION_MIN_LENGTH) {
          out.push(withBounds({ kind: "cone" as const, system, path: 0, x, y: rock - FORMATION_ROOT, z, length: tip - (rock - FORMATION_ROOT), radius, dir: 1 as const }));
        }
      }
    }
  }
  return out;
};

/** Formations every FORMATION_STEP along every path (past the mouth ramps) and along every room. */
const buildFormations = (system: string, paths: readonly CavePath[], rooms: readonly Room[], pieces: readonly TunnelPiece[], decor: SeededStream): ConePiece[] => {
  const field = compileField(pieces);
  const cones: ConePiece[] = [];
  for (const path of paths) {
    const xz = pathXZ(path);
    for (let i = 0; i < path.samples.length; i++) {
      const s = path.samples[i];
      const perp = perpendicular(tangentAt(xz, i));
      // Every FORMATION_STEP: at the sample and halfway to the next.
      for (let half = 0; half < 2; half++) {
        if (half === 1 && i === path.samples.length - 1) break;
        const next = path.samples[Math.min(i + 1, path.samples.length - 1)];
        const t = half * 0.5;
        const x = s.x + (next.x - s.x) * t;
        const z = s.z + (next.z - s.z) * t;
        const floor = s.floor + (next.floor - s.floor) * t;
        const r = s.r + (next.r - s.r) * t;
        const mouthDist = Math.min(s.mouthDist, next.mouthDist);
        if (mouthDist < MOUTH_RAMP_END) continue;
        cones.push(...formationCones(system, field, { x, z, floor, halfWidth: r * FLOOR_HALF_WIDTH, px: perp.x, pz: perp.z, room: false }, decor));
      }
    }
  }
  for (const room of rooms) {
    const len = Math.hypot(room.bx - room.ax, room.bz - room.az);
    const dx = (room.bx - room.ax) / (len || 1);
    const dz = (room.bz - room.az) / (len || 1);
    const steps = Math.max(1, Math.round(len / FORMATION_STEP));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = room.ax + (room.bx - room.ax) * t;
      const z = room.az + (room.bz - room.az) * t;
      cones.push(...formationCones(system, field, { x, z, floor: room.floor, halfWidth: room.piece.radius * FLOOR_HALF_WIDTH, px: -dz, pz: dx, room: true }, decor));
    }
  }
  return cones;
};

// ── Assembly ──────────────────────────────────────────────────────────────

/** Tubes between consecutive samples. */
const tubesOf = (system: string, path: CavePath): TubePiece[] => {
  const out: TubePiece[] = [];
  const s = path.samples;
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i];
    const b = s[i + 1];
    out.push(withBounds({ kind: "tube" as const, system, path: path.index, ax: a.x, ay: a.floor, az: a.z, bx: b.x, by: b.floor, bz: b.z, ra: a.r, rb: b.r, bulgeA: a.bulge, bulgeB: b.bulge, bumpA: a.bump, bumpB: b.bump }));
  }
  return out;
};

/** Skirt masks: a capsule over each run of up to MASK_RUN of a path, grown to hold the run's air. */
/** A mask around a round section's axis (a mouth, a room, a hall): its air tops out a radius over the axis. */
const capsuleMask = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number): SkirtMask => ({ ax, ay, az, bx, by, bz, radius, ceiling: Math.max(ay, by) + radius });

const masksOf = (path: CavePath): SkirtMask[] => {
  const out: SkirtMask[] = [];
  const s = path.samples;
  const per = Math.max(1, Math.round(MASK_RUN / PATH_STEP));
  for (let i = 0; i < s.length - 1; i += per) {
    const j = Math.min(s.length - 1, i + per);
    const a = s[i];
    const b = s[j];
    let r = 0;
    let ceiling = -Infinity;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dy = b.floor - a.floor;
    const l2 = dx * dx + dz * dz + dy * dy || 1;
    for (let k = i; k <= j; k++) {
      const p = s[k];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz + (p.floor - a.floor) * dy) / l2));
      const off = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t, p.floor - a.floor - dy * t);
      r = Math.max(r, off + p.r * (1 + p.bulge) + p.bump);
      ceiling = Math.max(ceiling, p.floor + AXIS_LIFT * p.r + p.r * (1 + p.bulge) + p.bump);
    }
    out.push({ ax: a.x, ay: a.floor + AXIS_LIFT * a.r, az: a.z, bx: b.x, by: b.floor + AXIS_LIFT * b.r, bz: b.z, radius: r, ceiling });
  }
  return out;
};

/** The skirt masks of a system: one capsule per mouth section, the paths' runs, one per room. */
const systemMasks = (mouths: readonly MouthPiece[], paths: readonly CavePath[], rooms: readonly Room[]): SkirtMask[] => {
  const masks: SkirtMask[] = [];
  for (const m of mouths) {
    const end = innerEnd(m);
    masks.push(capsuleMask(m.ox, m.oy + AXIS_LIFT * m.r0, m.oz, end.x, end.y + AXIS_LIFT * m.r1, end.z, m.width));
  }
  for (const path of paths) masks.push(...masksOf(path));
  for (const room of rooms) masks.push(capsuleMask(room.ax, room.floor + AXIS_LIFT * room.piece.radius, room.az, room.bx, room.floor + AXIS_LIFT * room.piece.radius, room.bz, room.piece.radius));
  return masks;
};

/** One cave system for a biome cell, or null when no mouth can be found. */
export const generateCave = (key: string, biomeId: number, ix: number, iz: number, site: PointXZ, sideRooms: CaveSideRoomParams | null): TunnelSystem | null => {
  const seedBase = `${domainConfig!.seed}|${key}`;
  const layout = seededStream(`${seedBase}|layout`);
  const decor = seededStream(`${seedBase}|decor`);

  const found = findEntry(key, site, biomeId, layout, decor);
  if (!found) return null;
  let entry = found.entry;
  let exit = findExit(key, site, biomeId, entry, found.angle, layout, decor);

  // The trunk's settled floors set each mouth's inner floor. A section steeper than the limit is no
  // way in: a steep exit turns the cave into a loop, a steep entry leaves no cave.
  let trunk = buildTrunk(entry, exit, layout);
  if (exit) {
    const last = trunk.samples[trunk.samples.length - 1].floor;
    if (sectionTooSteep(exit, last)) {
      exit = null;
      trunk = buildTrunk(entry, null, layout);
    } else exit = settledMouth(exit, last);
  }
  const first = trunk.samples[0].floor;
  if (sectionTooSteep(entry, first)) return null;
  entry = settledMouth(entry, first);

  const branches = buildBranches(trunk, layout);
  const paths = [trunk, ...branches];
  // Last in the layout stream: a biome without side rooms keeps the same passages.
  const rooms = sideRooms ? buildRooms(key, trunk, branches, layout, sideRooms) : [];

  const mouths = exit ? [entry, exit] : [entry];
  const pieces: TunnelPiece[] = [...mouths];
  for (const path of paths) pieces.push(...tubesOf(key, path));
  for (const room of rooms) pieces.push(room.piece);
  pieces.push(...buildFormations(key, paths, rooms, pieces, decor));

  const entrances: TunnelEntrance[] = mouths.map((m) => ({ kind: "mouth" as const, id: m.id, x: m.ox, y: m.oy, z: m.oz, dirX: m.dx, dirZ: m.dz, radius: m.r0 }));
  const bounds = emptyBounds();
  for (const p of pieces) growBounds(bounds, p.bounds);
  return { key, style: "cave", biomeId, ix, iz, pieces, mouths, entrances, masks: systemMasks(mouths, paths, rooms), bounds };
};

// ── Mouth rocks (consumed by the rock dressing), on the BULGED ground ─────────

/** Whether the (bulged) ground at a point lies in the mouth's air: inside its ragged opening. */
const insideHole = (m: MouthPiece, x: number, z: number): boolean => insideMouthOpening(m, x, heightAt(x, z), z);

const spaced = (spots: readonly RockSpot[], x: number, z: number, minDist: (s: RockSpot) => number): boolean => {
  for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < minDist(s)) return false;
  return true;
};

/** The rim rocks: cells of a RIM_GRID grid over the section (RIM_FRONT in front of the opening,
 *  RIM_SIDE_PAD beside its widest outline) whose ground lies outside the opening with a neighbour's
 *  inside it, each with RIM_ROCK_CHANCE where the ground rises RIM_ROCK_RISE over the floor, set back
 *  outward from the axis by RIM_ROCK_SETBACK of its size. */
const rimSpots = (m: MouthPiece, decor: SeededStream, spots: RockSpot[]): void => {
  const px = -m.dz;
  const pz = m.dx;
  const side = m.width + RIM_SIDE_PAD;
  const cells = new Map<string, boolean>();
  const cellInside = (ia: number, il: number): boolean => {
    const k = `${ia},${il}`;
    let v = cells.get(k);
    if (v === undefined) {
      const x = m.ox + m.dx * ia * RIM_GRID + px * il * RIM_GRID;
      const z = m.oz + m.dz * ia * RIM_GRID + pz * il * RIM_GRID;
      v = insideHole(m, x, z);
      cells.set(k, v);
    }
    return v;
  };
  const ia0 = Math.ceil(-RIM_FRONT / RIM_GRID);
  const ia1 = Math.floor(m.length / RIM_GRID);
  const il1 = Math.floor(side / RIM_GRID);
  for (let ia = ia0; ia <= ia1; ia++) {
    for (let il = -il1; il <= il1; il++) {
      if (cellInside(ia, il)) continue;
      const rim = cellInside(ia + 1, il) || cellInside(ia - 1, il) || cellInside(ia, il + 1) || cellInside(ia, il - 1);
      if (!rim) continue;
      const cx = m.ox + m.dx * ia * RIM_GRID + px * il * RIM_GRID;
      const cz = m.oz + m.dz * ia * RIM_GRID + pz * il * RIM_GRID;
      const floor = m.oy - m.grade * Math.max(0, Math.min(m.length, ia * RIM_GRID));
      if (decor.next() >= RIM_ROCK_CHANCE) continue;
      if (heightAt(cx, cz) - floor < RIM_ROCK_RISE) continue;
      const u = decor.next();
      const size = RIM_ROCK_SIZE_MIN + (RIM_ROCK_SIZE_MAX - RIM_ROCK_SIZE_MIN) * u * u;
      // Outward: away from the section's axis.
      const lat = mouthLateral(m, cx, cz);
      const along = mouthAlong(m, cx, cz);
      let ox = lat >= 0 ? px : -px;
      let oz = lat >= 0 ? pz : -pz;
      if (along < 0) {
        ox = -m.dx;
        oz = -m.dz;
      }
      const x = cx + ox * size * RIM_ROCK_SETBACK;
      const z = cz + oz * size * RIM_ROCK_SETBACK;
      if (insideHole(m, x, z)) continue;
      if (!spaced(spots, x, z, () => RIM_ROCK_SPACING)) continue;
      spots.push({ x, z, size });
    }
  }
};

/** STREWN_MIN–MAX strewn rocks from STREWN_FRONT_SHARE of their reach in front of the opening to the
 *  reach into the mountain, the approach kept clear, sizes cubically biased small, spaced apart. */
const strewnSpots = (m: MouthPiece, decor: SeededStream, spots: RockSpot[]): void => {
  const px = -m.dz;
  const pz = m.dx;
  const strewn = decor.intBetween(STREWN_MIN, STREWN_MAX);
  const reach = STREWN_REACH_RADII * m.r0;
  for (let k = 0; k < strewn; k++) {
    for (let t = 0; t < STREWN_TRIES; t++) {
      const a = decor.between(-STREWN_FRONT_SHARE * reach, reach);
      const l = decor.between(-reach, reach);
      const x = m.ox + m.dx * a + px * l;
      const z = m.oz + m.dz * a + pz * l;
      const u = decor.next();
      const size = STREWN_SIZE_MIN + (STREWN_SIZE_MAX - STREWN_SIZE_MIN) * u * u * u;
      const along = mouthAlong(m, x, z);
      const lat = Math.abs(mouthLateral(m, x, z));
      if (along < STREWN_APPROACH_IN * m.r0 && lat < m.r0 + size + STREWN_APPROACH_PAD) continue;
      if (insideHole(m, x, z)) continue;
      if (!spaced(spots, x, z, (s) => s.size + size + STREWN_SPACING_PAD)) continue;
      spots.push({ x, z, size });
      break;
    }
  }
};

const spotsPlaced = new WeakSet<MouthPiece>();

/** Where a mouth's rocks stand: the rim rocks, then the strewn rocks. Computed once, after the system
 *  exists (the ground read here is bulged). */
export const mouthSpots = (m: MouthPiece): RockSpot[] => {
  if (spotsPlaced.has(m)) return m.spots;
  spotsPlaced.add(m);
  const decor = seededStream(`${domainConfig!.seed}|${m.id}|rocks`);
  const spots: RockSpot[] = [];
  rimSpots(m, decor, spots);
  strewnSpots(m, decor, spots);
  m.spots = spots;
  return spots;
};

// ── Spring caves ──────────────────────────────────────────────────────────

/** The shortest section from a spring's opening (descending at SPRING_SECTION_GRADE) that keeps
 *  ROCK_COVER over the passage's crown at its inner end; NaN when none does. Like settleSection without
 *  the fitness test: the opening stands IN the river, by design. */
const settleSpringSection = (site: SpringSite, oy: number, r1: number): number => {
  const px = -site.dz;
  const pz = site.dx;
  for (let length = SECTION_MIN; length <= SECTION_MAX; length += SECTION_STEP) {
    if (coverCap(site.x + site.dx * length, site.z + site.dz * length, px, pz, r1) >= oy - SPRING_SECTION_GRADE * length) return length;
  }
  return NaN;
};

/** A spring's mouth and lead, planned before the cell's springs are paired (springSystemsAt). */
export interface SpringPlan {
  key: string;
  site: SpringSite;
  mouth: MouthPiece;
  r1: number;
  /** The lead's far floor point. */
  leadEnd: { x: number; y: number; z: number };
  /** The river's water, just under its surface. */
  level: number;
  pieces: TunnelPiece[];
  masks: SkirtMask[];
  liquid: SpringWater[];
}

/** Where a river runs into the mountain: a mouth sized to the river's narrowed width with its floor
 *  SPRING_SINK under the water, descending only gently (the passage stays wadeable, its crown in the
 *  air), then a flooded lead. Null when no section keeps its cover (the river then ends against the
 *  rock). The mouth's rock spots are empty: the opening is water. */
export const planSpring = (key: string, site: SpringSite): SpringPlan | null => {
  const decor = seededStream(`${domainConfig!.seed}|${key}|decor`);
  const oy = site.surface - SPRING_SINK;
  const r0 = Math.min(SPRING_OPENING_MAX, Math.max(OPENING_RADIUS_MIN, site.halfWidth + SPRING_OPENING_PAD));
  const r1 = decor.between(PASSAGE_RADIUS_MIN, PASSAGE_RADIUS_MAX);
  const length = settleSpringSection(site, oy, r1);
  if (Number.isNaN(length)) return null;
  const mouth: MouthPiece = withBounds({ kind: "mouth" as const, system: key, path: 0, id: `${key}:mouth0`, ox: site.x, oy, oz: site.z, dx: site.dx, dz: site.dz, length, r0, r1, grade: SPRING_SECTION_GRADE, phase: decor.next() * Math.PI * 2, width: r0 * (1 + MOUTH_RIM_AMP), spots: [] });
  spotsPlaced.add(mouth);
  const end = innerEnd(mouth);
  const leadEnd = { x: end.x + site.dx * SPRING_LEAD, y: end.y - 0.5, z: end.z + site.dz * SPRING_LEAD };
  const level = site.surface - SPRING_WATER_BELOW_SURFACE;
  const pieces: TunnelPiece[] = [mouth, withBounds({ kind: "tube" as const, system: key, path: 0, ax: end.x, ay: end.y, az: end.z, bx: leadEnd.x, by: leadEnd.y, bz: leadEnd.z, ra: r1, rb: r1, bulgeA: 0, bulgeB: WALL_BULGE, bumpA: 0, bumpB: 0 })];
  const masks: SkirtMask[] = [capsuleMask(mouth.ox, mouth.oy + AXIS_LIFT * r0, mouth.oz, leadEnd.x, leadEnd.y + AXIS_LIFT * r1, leadEnd.z, mouth.width)];
  // The water of the opening, the section and the lead: one strip, as wide as the opening.
  const px = -site.dz;
  const pz = site.dx;
  const half = r0 * (1 + WALL_BULGE);
  // The river's source: its water runs OUT of the opening, at a slow river's pace.
  const flow = riverFlowSpeed(0);
  const liquid: SpringWater[] = [
    {
      points: [
        [mouth.ox - px * half, level, mouth.oz - pz * half],
        [mouth.ox + px * half, level, mouth.oz + pz * half],
        [leadEnd.x + px * half, level, leadEnd.z + pz * half],
        [leadEnd.x - px * half, level, leadEnd.z - pz * half],
      ],
      depth: SPRING_STRIP_DEPTH,
      flowX: -site.dx * flow,
      flowZ: -site.dz * flow,
    },
  ];
  return { key, site, mouth, r1, leadEnd, level, pieces, masks, liquid };
};

/** How far apart two springs' leads end; they CONNECT within SPRING_SHARE_REACH (systems.ts pairs each
 *  with its MUTUAL nearest, whatever their levels: the hall's water slopes between them). */
export const springGap = (a: SpringPlan, b: SpringPlan): number => Math.hypot(a.leadEnd.x - b.leadEnd.x, a.leadEnd.z - b.leadEnd.z);

/** What a finish adds to a plan's own mouth and lead. */
type SpringExtra = { pieces: TunnelPiece[]; masks: SkirtMask[]; liquid: SpringWater[] };
const noExtra = (): SpringExtra => ({ pieces: [], masks: [], liquid: [] });

/** A spring's system from its plan (the plan is cached and shared by every cell around: nothing of it
 *  is mutated) plus whatever the finish adds. */
const springSystem = (plan: SpringPlan, biomeId: number, ix: number, iz: number, extra: SpringExtra): TunnelSystem => {
  const m = plan.mouth;
  const entrances: TunnelEntrance[] = [{ kind: "mouth", id: m.id, x: m.ox, y: m.oy, z: m.oz, dirX: m.dx, dirZ: m.dz, radius: m.r0 }];
  const pieces = [...plan.pieces, ...extra.pieces];
  const bounds = emptyBounds();
  for (const p of pieces) growBounds(bounds, p.bounds);
  return { key: plan.key, style: "cave", biomeId, ix, iz, pieces, mouths: [m], entrances, masks: [...plan.masks, ...extra.masks], bounds, liquid: [...plan.liquid, ...extra.liquid] };
};

/** A paired spring that did not dig the hall: its mouth and lead alone (the hall is its partner's). */
export const finishPairedSpring = (plan: SpringPlan, biomeId: number, ix: number, iz: number): TunnelSystem => springSystem(plan, biomeId, ix, iz, noExtra());

/** A lone spring's end: the POOL ROOM — a capsule on along the lead, as large as the rock over it
 *  allows (judged across its middle), its floor SPRING_POOL_DEPTH under the lead's, its water the
 *  river's level (a 12-gon per end and the rectangle between) — or nothing, where no size fits. */
export const finishLoneSpring = (plan: SpringPlan, biomeId: number, ix: number, iz: number): TunnelSystem => {
  const { site, leadEnd, level } = plan;
  const px = -site.dz;
  const pz = site.dx;
  const extra = noExtra();
  for (const radius of [SPRING_ROOM_RADIUS, SPRING_ROOM_RADIUS_MIN]) {
    const floor = leadEnd.y - SPRING_POOL_DEPTH;
    const ax = leadEnd.x + site.dx * radius;
    const az = leadEnd.z + site.dz * radius;
    const bx = ax + site.dx * SPRING_ROOM_LENGTH;
    const bz = az + site.dz * SPRING_ROOM_LENGTH;
    if (coverCap((ax + bx) / 2, (az + bz) / 2, px, pz, radius) < floor) continue;
    extra.pieces.push(withBounds({ kind: "room" as const, system: plan.key, path: 0, ax, ay: floor, az, bx, by: floor, bz, radius }));
    extra.masks.push(capsuleMask(ax, floor + AXIS_LIFT * radius, az, bx, floor + AXIS_LIFT * radius, bz, radius));
    const r = radius * (1 + WALL_BULGE);
    const depth = SPRING_POOL_DEPTH + (plan.level - leadEnd.y);
    for (const [cx, cz] of [
      [ax, az],
      [bx, bz],
    ]) {
      const points: [number, number, number][] = [];
      for (let k = 0; k < POOL_POLYGON_SIDES; k++) {
        const a = (k * 2 * Math.PI) / POOL_POLYGON_SIDES;
        points.push([cx + Math.cos(a) * r, level, cz + Math.sin(a) * r]);
      }
      extra.liquid.push({ points, depth, flowX: 0, flowZ: 0 });
    }
    extra.liquid.push({
      points: [
        [ax - px * r, level, az - pz * r],
        [ax + px * r, level, az + pz * r],
        [bx + px * r, level, bz + pz * r],
        [bx - px * r, level, bz - pz * r],
      ],
      depth,
      flowX: 0,
      flowZ: 0,
    });
    break;
  }
  return springSystem(plan, biomeId, ix, iz, extra);
};

const POOL_POLYGON_SIDES = 12;

/** Two springs that connect: ONE river through the mountain. A HALL (a wide tube, SPRING_HALL_RADIUS)
 *  joins the two leads' ends, its floor SPRING_HALL_DEPTH under the water, and the water runs through
 *  it in one sheet sloping from the higher mouth's level to the lower's (two rivers never share a
 *  pool: each kept its own surface and one stood a step above the other, Evan at (−6615, 8821)). The
 *  hall and its water belong to this spring's system (the pair's first by key); the partner keeps its
 *  mouth and lead (finishPairedSpring). Whatever the two levels: the hall's water slopes as it must. */
export const finishConnectedSpring = (a: SpringPlan, b: SpringPlan, biomeId: number, ix: number, iz: number): TunnelSystem => {
  const extra = noExtra();
  const ax = a.leadEnd.x;
  const az = a.leadEnd.z;
  const bx = b.leadEnd.x;
  const bz = b.leadEnd.z;
  const floorA = a.level - SPRING_HALL_DEPTH;
  const floorB = b.level - SPRING_HALL_DEPTH;
  const r = SPRING_HALL_RADIUS;
  // The leads rise from their deep ends onto the hall's floor (same path: the tubes union plainly).
  extra.pieces.push(withBounds({ kind: "tube" as const, system: a.key, path: 0, ax, ay: a.leadEnd.y, az, bx: ax, by: floorA, bz: az, ra: a.r1, rb: r, bulgeA: WALL_BULGE, bulgeB: WALL_BULGE, bumpA: 0, bumpB: 0 }));
  extra.pieces.push(withBounds({ kind: "tube" as const, system: a.key, path: 0, ax, ay: floorA, az, bx, by: floorB, bz, ra: r, rb: r, bulgeA: WALL_BULGE, bulgeB: WALL_BULGE, bumpA: 0, bumpB: 0 }));
  extra.pieces.push(withBounds({ kind: "tube" as const, system: a.key, path: 0, ax: bx, ay: floorB, az: bz, bx, by: b.leadEnd.y, bz, ra: r, rb: b.r1, bulgeA: WALL_BULGE, bulgeB: WALL_BULGE, bumpA: 0, bumpB: 0 }));
  extra.masks.push(capsuleMask(ax, floorA + AXIS_LIFT * r, az, bx, floorB + AXIS_LIFT * r, bz, r * (1 + WALL_BULGE)));
  const dx = bx - ax;
  const dz = bz - az;
  const l = Math.hypot(dx, dz) || 1;
  const half = r * (1 + WALL_BULGE);
  const px = (-dz / l) * half;
  const pz = (dx / l) * half;
  // The hall's water runs from the higher mouth's level to the lower's, at the river's pace for that grade.
  const drop = a.level - b.level;
  const flow = drop === 0 ? 0 : riverFlowSpeed(Math.abs(drop) / l) * Math.sign(drop);
  extra.liquid.push({
    points: [
      [ax - px, a.level, az - pz],
      [ax + px, a.level, az + pz],
      [bx + px, b.level, bz + pz],
      [bx - px, b.level, bz - pz],
    ],
    depth: SPRING_HALL_DEPTH,
    flowX: (dx / l) * flow,
    flowZ: (dz / l) * flow,
  });
  return springSystem(a, biomeId, ix, iz, extra);
};
