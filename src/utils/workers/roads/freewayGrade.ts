/**
 * The GRADE a freeway off the city rides (computeVertexData step 5): one height per centerline
 * point, flat across the road. It is the terrain at the centerline point evaluated with that
 * point's OWN wall pass (terrainOnlyAt) — with the vertex's weights, the two halves of a road lying
 * on a biome or region wall (runs ARE walls, and the belt's outer half leaves the crisp city) would
 * read different weights and rise to different grades, a crease along the centerline. Sampled on a
 * lattice of GRADE_STEP points along each segment (cached, a pure function of the segment), a run's
 * smoothed along it over ±2 GRADE_STEP (its first units leave the crisp city's grade for the
 * neighbor's terrain within 2u), and blended by distance over every segment holding a nearest
 * point: the nearest point alone jumps between the two legs inside a bend, between runs at a hub
 * and between the belt and a run leaving it. Steep grades and cuts stay: they are the terrain's.
 */

import { smoothstep } from "../../math/_math";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import type { BiomeContext } from "../types";
import { terrainOnlyAt } from "../vertexCompute";
import { cityWallsOf } from "../voronoi";
import { FREEWAY_SMIN_K, type FreewayRun, collectRunCandidates, networkOf, pushSegCandidate, segCandidates } from "./freewayNetwork";

/** The road grade takes over the terrain this far past the freeway's half-width (real units). */
export const FREEWAY_GRADE_RAMP = 10;

const GRADE_STEP = 8;
const GRADE_TAPS = [-2, -1, 0, 1, 2];
const GRADE_TAP_WEIGHTS = [1, 2, 3, 2, 1];
const gradeSamples = new Map<string, number>();

/** The centerline terrain at fraction f of a warped segment, from its GRADE_STEP lattice (canonical:
 *  the same samples from either direction). `own` is a run's per-segment copy of that lattice (NaN =
 *  not yet sampled), so its hot path builds no string key. */
const segmentGrade = (ax: number, az: number, bx: number, bz: number, f: number, own?: Float64Array): number => {
  if (bx < ax || (bx === ax && bz < az)) return segmentGrade(bx, bz, ax, az, 1 - f, own);
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / GRADE_STEP));
  const u = Math.max(0, Math.min(1, f)) * n;
  const k = Math.min(n - 1, Math.floor(u));
  const sample = (i: number): number => {
    if (own && !Number.isNaN(own[i])) return own[i];
    const key = `${ax},${az},${bx},${bz},${i}`;
    let g = gradeSamples.get(key);
    if (g === undefined) {
      if (gradeSamples.size > 200000) dropOldestHalf(gradeSamples);
      const p = unwarp(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      g = terrainOnlyAt(p.x, p.z);
      gradeSamples.set(key, g);
    }
    if (own) own[i] = g;
    return g;
  };
  const g0 = sample(k);
  return g0 + (sample(k + 1) - g0) * (u - k);
};
const runSegmentGrades = new WeakMap<FreewayRun, (Float64Array | undefined)[]>();
const runSegmentLattice = (run: FreewayRun, i: number): Float64Array => {
  let list = runSegmentGrades.get(run);
  if (!list) runSegmentGrades.set(run, (list = []));
  let lat = list[i];
  if (!lat) {
    const p = run.pts;
    const n = Math.max(1, Math.ceil(Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]) / GRADE_STEP));
    list[i] = lat = new Float64Array(n + 1).fill(NaN);
  }
  return lat;
};
/** A run's centerline terrain at arc s. */
const runPointGrade = (run: FreewayRun, s: number): number => {
  const cum = run.cum;
  const c = Math.max(0, Math.min(run.length, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= c) lo = m;
    else hi = m;
  }
  const len = cum[hi] - cum[lo];
  const p = run.pts;
  return segmentGrade(p[lo * 2], p[lo * 2 + 1], p[hi * 2], p[hi * 2 + 1], len > 0 ? (c - cum[lo]) / len : 0, runSegmentLattice(run, lo));
};
const runGrade = (run: FreewayRun, s: number): number => {
  let sum = 0;
  let wsum = 0;
  // Past an end the grade is carried on by point reflection (2·g(end) − g(mirror)), so the smoothing
  // keeps the end's own grade: two runs meeting at a hub agree there (clamped taps would leave them
  // units apart on a steep hub).
  const L = run.length;
  for (let k = 0; k < GRADE_TAPS.length; k++) {
    const t = s + GRADE_TAPS[k] * GRADE_STEP;
    const g = t < 0 ? 2 * runPointGrade(run, 0) - runPointGrade(run, -t) : t > L ? 2 * runPointGrade(run, L) - runPointGrade(run, 2 * L - t) : runPointGrade(run, t);
    sum += GRADE_TAP_WEIGHTS[k] * g;
    wsum += GRADE_TAP_WEIGHTS[k];
  }
  return sum / wsum;
};
/** Per candidate, the share of its weight it keeps (gradeShares). */
const gradeShare: number[] = [];
/** 1 for a candidate whose leg an earlier candidate already lists (every wall is listed both ways). */
const gradeRepeat: number[] = [];
const gradeRuns: FreewayRun[] = [];
const gradeRunW: number[] = [];
const gradeRunS: number[] = [];
/** How far along its segment (warped units) the WORLD cross-section through (wx, wz) meets a candidate
 *  point — its projection is found in warped space, and the road warp shears (up to ~25° off square
 *  across the road), which would tilt the road across on a steep grade. */
const worldAlongShift = (k: number, wx: number, wz: number): number => {
  const { seg, x, z } = segCandidates;
  const dx = seg[k * 4 + 2] - seg[k * 4];
  const dz = seg[k * 4 + 3] - seg[k * 4 + 1];
  const l = Math.hypot(dx, dz);
  if (l < 1e-9) return 0;
  const c = unwarp(x[k], z[k]);
  const a = unwarp(x[k] + dx / l, z[k] + dz / l);
  const tx = a.x - c.x;
  const tz = a.z - c.z;
  const tl2 = tx * tx + tz * tz;
  return tl2 > 1e-12 ? ((wx - c.x) * tx + (wz - c.z) * tz) / tl2 : 0;
};
/** A leg past an end it shares with another leg gives way to that leg over this far (warped units). */
const SHARED_END_FADE = 8;
/** How far the point lies past a candidate leg's end at (ex, ez) along the leg (0 when it projects
 *  inside the leg, or the end is not this leg's). */
const pastEnd = (k: number, px: number, pz: number, ex: number, ez: number): number => {
  const { seg } = segCandidates;
  const sx = seg[k * 4];
  const sz = seg[k * 4 + 1];
  const tx = seg[k * 4 + 2];
  const tz = seg[k * 4 + 3];
  const l = Math.hypot(tx - sx, tz - sz);
  if (l < 1e-9) return 0;
  const u = ((px - sx) * (tx - sx) + (pz - sz) * (tz - sz)) / l;
  if (Math.abs(sx - ex) < 1e-6 && Math.abs(sz - ez) < 1e-6) return Math.max(0, -u);
  if (Math.abs(tx - ex) < 1e-6 && Math.abs(tz - ez) < 1e-6) return Math.max(0, u - l);
  return 0;
};
/** Each candidate within FREEWAY_SMIN_K's reach keeps a share of its weight (gradeShare): the same leg
 *  listed twice (every wall is) counts once, and a leg the point lies PAST the end of, where another leg
 *  ends too, gives way to that leg as far as it lies further past it than the other does (1 −
 *  smoothstep(0, SHARED_END_FADE, its excess)). A leg the point projects inside of keeps all of it; two
 *  legs it lies past (the outer side of a bend) share by how far past each it lies. Dropping such a leg
 *  outright where the other leg covered it, and counting the first-listed one where both were past their
 *  ends, flipped legs on lines through the vertex — 1.14u of grade at (-11039, 9514), 0.27u beside a
 *  belt corner at (-11123, 9734). */
const gradeShares = (px: number, pz: number, n: number, dmin: number): void => {
  const { d, seg } = segCandidates;
  for (let k = 0; k < n; k++) {
    gradeRepeat[k] = 0;
    for (let o = 0; o < k && gradeRepeat[k] === 0; o++) if (sameLeg(seg, o, k)) gradeRepeat[k] = 1;
  }
  // (The first-listed copy of a leg within reach is the one counted.)
  for (let k = 0; k < n; k++) {
    gradeShare[k] = d[k] - dmin < FREEWAY_SMIN_K ? 1 : 0;
    for (let o = 0; o < k && gradeShare[k] > 0; o++) if (gradeShare[o] > 0 && sameLeg(seg, o, k)) gradeShare[k] = 0;
  }
  for (let k = 0; k < n; k++) {
    if (gradeShare[k] === 0) continue;
    for (let end = 0; end < 2; end++) {
      const ex = seg[k * 4 + end * 2];
      const ez = seg[k * 4 + end * 2 + 1];
      const past = pastEnd(k, px, pz, ex, ez);
      if (past <= 0) continue;
      for (let o = 0; o < n; o++) {
        if (o === k || gradeRepeat[o] === 1 || sameLeg(seg, o, k) || !endsAt(seg, o, ex, ez)) continue;
        gradeShare[k] *= 1 - smoothstep(0, SHARED_END_FADE, past - pastEnd(o, px, pz, ex, ez));
      }
    }
  }
};
const endsAt = (seg: number[], o: number, ex: number, ez: number): boolean =>
  (Math.abs(seg[o * 4] - ex) < 1e-6 && Math.abs(seg[o * 4 + 1] - ez) < 1e-6) || (Math.abs(seg[o * 4 + 2] - ex) < 1e-6 && Math.abs(seg[o * 4 + 3] - ez) < 1e-6);
const sameLeg = (seg: number[], a: number, b: number): boolean => {
  const near = (i: number, j: number) => Math.abs(seg[a * 4 + i] - seg[b * 4 + j]) < 1e-6 && Math.abs(seg[a * 4 + i + 1] - seg[b * 4 + j + 1]) < 1e-6;
  return (near(0, 0) && near(2, 2)) || (near(0, 2) && near(2, 0));
};

/** The grade of the freeway(s) nearest a warped point (px, pz) off the city — world (wx, wz) — or NaN
 *  with none in reach. `withRuns` false (far visual LODs) sees the city belt alone. Clobbers the
 *  wall-pass scratch: call it before the vertex's own wall pass. */
export const freewayGradeAt = (px: number, pz: number, wx: number, wz: number, ctx: BiomeContext, withRuns: boolean): number => {
  const fw = domainConfig!.cityConfig.freewayWidth;
  const reach = fw + FREEWAY_GRADE_RAMP + FREEWAY_SMIN_K + 4;
  segCandidates.n = 0;
  if (!ctx.zone.biome.water && withRuns) collectRunCandidates(px, pz, networkOf(ctx).freeways, reach);
  for (const w of cityWallsOf(ctx)) {
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const d = Math.hypot(px - cx, pz - cz);
    if (d <= reach) pushSegCandidate(null, 0, d, cx, cz, t, w.sx, w.sz, w.ex, w.ez);
  }
  const n = segCandidates.n;
  if (n === 0) return NaN;
  const { d, t, seg, run, along } = segCandidates;
  let dmin = Infinity;
  for (let k = 0; k < n; k++) dmin = Math.min(dmin, d[k]);
  let sum = 0;
  let wsum = 0;
  // A leg the point lies past the end of, where another leg ends, is that leg's (gradeShares): counted
  // at full weight too it would vary the blend across the road.
  gradeShares(px, pz, n, dmin);
  for (let k = 0; k < n; k++) {
    if (gradeShare[k] === 0) continue;
    const h = 1 - (d[k] - dmin) / FREEWAY_SMIN_K;
    const h2 = h * h * gradeShare[k];
    const r = run[k];
    const shift = worldAlongShift(k, wx, wz);
    if (r) {
      // The legs of one run are one road: blended by WHERE along it, not by grade — inside a bend the
      // lines of equal grade then fan out from the bend (grades blended by distance would tilt the
      // road across the bend on a steep run).
      let slot = -1;
      for (let o = 0; o < gradeRuns.length; o++) if (gradeRuns[o] === r) slot = o;
      if (slot < 0) {
        slot = gradeRuns.length;
        gradeRuns.push(r);
        gradeRunW.push(0);
        gradeRunS.push(0);
      }
      gradeRunW[slot] += h2;
      gradeRunS[slot] += h2 * (along[k] + shift);
      continue;
    }
    const segLen = Math.hypot(seg[k * 4 + 2] - seg[k * 4], seg[k * 4 + 3] - seg[k * 4 + 1]) || 1;
    sum += h2 * segmentGrade(seg[k * 4], seg[k * 4 + 1], seg[k * 4 + 2], seg[k * 4 + 3], t[k] + shift / segLen);
    wsum += h2;
  }
  for (let o = 0; o < gradeRuns.length; o++) {
    sum += gradeRunW[o] * runGrade(gradeRuns[o], gradeRunS[o] / gradeRunW[o]);
    wsum += gradeRunW[o];
  }
  gradeRuns.length = 0;
  gradeRunW.length = 0;
  gradeRunS.length = 0;
  return wsum > 0 ? sum / wsum : NaN;
};

/** The grade samples are terrain values: stale across an init (a domain switch). The per-run lattices
 *  are keyed by run objects, which the network cache rebuilds. */
export const clearFreewayGrades = (): void => gradeSamples.clear();
