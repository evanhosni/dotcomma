/**
 * A cave PATH: a course on the ground plan, sampled every PATH_STEP, each sample with its floor, radius,
 * wall lumps and floor bumps; consecutive samples become the path's tubes. The floor rules every path
 * shares live here: the cover the rock overhead allows and the grade no step may pass. Three-free.
 */
import type { PointXZ } from "../../../utils/math/types";
import { computeVertexData } from "../..";
import { AXIS_LIFT, ROCK_COVER } from "../constants";
import { COVER_FLANK_PAD, FLOOR_GRADE, PATH_STEP } from "./constants";
import { withBounds } from "../field";
import type { TubePiece } from "../types";
import type { PathSample } from "./types";

/** A Catmull–Rom course through `points` (open: the ends' tangents point along `startDir` / out of the
 *  last segment), densified for resampling. */
export const smoothCourse = (points: readonly PointXZ[], closed: boolean, startDir?: PointXZ): PointXZ[] => {
  const n = points.length;
  const at = (i: number): PointXZ => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) {
      const a = points[0];
      if (startDir) return { x: a.x - startDir.x * Math.hypot(points[1].x - a.x, points[1].z - a.z), z: a.z - startDir.z * Math.hypot(points[1].x - a.x, points[1].z - a.z) };
      return { x: 2 * a.x - points[1].x, z: 2 * a.z - points[1].z };
    }
    if (i >= n) return { x: 2 * points[n - 1].x - points[n - 2].x, z: 2 * points[n - 1].z - points[n - 2].z };
    return points[i];
  };
  const out: PointXZ[] = [];
  const segments = closed ? n : n - 1;
  const per = 16;
  for (let s = 0; s < segments; s++) {
    const p0 = at(s - 1);
    const p1 = at(s);
    const p2 = at(s + 1);
    const p3 = at(s + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * (2 * p1.z + (p2.z - p0.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  out.push(closed ? { ...points[0] } : { ...points[n - 1] });
  return out;
};

/** A polyline resampled at even spacing of at most PATH_STEP, its ends kept exactly: points with their arc length. */
export const resample = (line: readonly PointXZ[]): { x: number; z: number; u: number }[] => {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
  const total = lengths[lengths.length - 1];
  const count = Math.max(1, Math.ceil(total / PATH_STEP));
  const out: { x: number; z: number; u: number }[] = [];
  let seg = 1;
  for (let k = 0; k <= count; k++) {
    const u = k === count ? total : (total * k) / count;
    while (seg < line.length - 1 && lengths[seg] < u) seg++;
    const span = lengths[seg] - lengths[seg - 1];
    const t = span > 0 ? (u - lengths[seg - 1]) / span : 0;
    const a = line[seg - 1];
    const b = line[seg];
    out.push(k === count ? { x: b.x, z: b.z, u } : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, u });
  }
  return out;
};

/** The highest floor the rock allows at (x, z) for a passage of `radius` and `bulge`: ROCK_COVER over its
 *  lumped crown, on the axis and on both flanks COVER_FLANK_PAD past the lumped wall (`side` is the unit
 *  across the path). */
export const coverFloorAt = (x: number, z: number, radius: number, bulge: number, sideX: number, sideZ: number): number => {
  const crown = (AXIS_LIFT + 1 + bulge) * radius;
  const flank = radius * (1 + bulge) + COVER_FLANK_PAD;
  let ground = computeVertexData(x, z).height;
  ground = Math.min(ground, computeVertexData(x + sideX * flank, z + sideZ * flank).height, computeVertexData(x - sideX * flank, z - sideZ * flank).height);
  return ground - ROCK_COVER - crown;
};

/** The unit across the path at sample i (its tangent turned left). */
export const sideAt = (s: readonly { x: number; z: number }[], i: number): PointXZ => {
  const a = s[Math.max(0, i - 1)];
  const b = s[Math.min(s.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
};

/** Lowers floors (never raises them) until no step between neighbours climbs or falls faster than FLOOR_GRADE. */
export const limitGrade = (samples: PathSample[]): void => {
  for (let i = 1; i < samples.length; i++) {
    const run = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    samples[i].floor = Math.min(samples[i].floor, samples[i - 1].floor + FLOOR_GRADE * run);
  }
  for (let i = samples.length - 2; i >= 0; i--) {
    const run = Math.hypot(samples[i + 1].x - samples[i].x, samples[i + 1].z - samples[i].z);
    samples[i].floor = Math.min(samples[i].floor, samples[i + 1].floor + FLOOR_GRADE * run);
  }
};

/** The ease out of a radius over a run: 0 → 1 as a smoothstep, written out so every product keeps its
 *  order (a refactor that moved one moved branch radii by an ulp; DECISIONS.md). */
export const eased = (from: number, to: number, ramp: number): number => from + (to - from) * ramp * ramp * (3 - 2 * ramp);

/** The path's tubes: one per pair of consecutive samples. */
export const tubesOf = (samples: readonly PathSample[], system: string, path: number): TubePiece[] => {
  const tubes: TubePiece[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    tubes.push(
      withBounds({
        kind: "tube" as const,
        system,
        path,
        ax: a.x,
        ay: a.floor,
        az: a.z,
        bx: b.x,
        by: b.floor,
        bz: b.z,
        ra: a.radius,
        rb: b.radius,
        bulgeA: a.bulge,
        bulgeB: b.bulge,
        bumpA: a.bump,
        bumpB: b.bump,
      }),
    );
  }
  return tubes;
};

/** The path's point at arc length u (between samples). */
export const pointAt = (samples: readonly PathSample[], u: number): PathSample => {
  let i = 1;
  while (i < samples.length - 1 && samples[i].u < u) i++;
  const a = samples[i - 1];
  const b = samples[i];
  const t = b.u > a.u ? Math.max(0, Math.min(1, (u - a.u) / (b.u - a.u))) : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    u,
    floor: a.floor + (b.floor - a.floor) * t,
    radius: a.radius + (b.radius - a.radius) * t,
    bulge: a.bulge + (b.bulge - a.bulge) * t,
    bump: a.bump + (b.bump - a.bump) * t,
  };
};
