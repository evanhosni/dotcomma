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
const gradeSkip: number[] = [];
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
  const { d, t, seg, x, z, run, along } = segCandidates;
  let dmin = Infinity;
  for (let k = 0; k < n; k++) dmin = Math.min(dmin, d[k]);
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < n; k++) {
    gradeSkip[k] = 1;
    if (d[k] - dmin >= FREEWAY_SMIN_K) continue;
    // A projection clamped to a segment's end that another segment ending there projects INSIDE of is
    // that segment's point (the nearer one): counting it too would vary the blend across the road.
    if (t[k] === 0 || t[k] === 1) {
      const ex = t[k] === 0 ? seg[k * 4] : seg[k * 4 + 2];
      const ez = t[k] === 0 ? seg[k * 4 + 1] : seg[k * 4 + 3];
      let covered = false;
      for (let o = 0; o < n && !covered; o++) {
        if (o === k || t[o] <= 0 || t[o] >= 1) continue;
        if ((Math.abs(seg[o * 4] - ex) < 1e-6 && Math.abs(seg[o * 4 + 1] - ez) < 1e-6) || (Math.abs(seg[o * 4 + 2] - ex) < 1e-6 && Math.abs(seg[o * 4 + 3] - ez) < 1e-6)) covered = true;
      }
      if (covered) continue;
    }
    // One place counted once (a wall listed twice, the outer side of a bend).
    let dup = false;
    for (let o = 0; o < k && !dup; o++) if (gradeSkip[o] === 0 && Math.abs(x[o] - x[k]) + Math.abs(z[o] - z[k]) < 1e-3) dup = true;
    if (dup) continue;
    gradeSkip[k] = 0;
    const h = 1 - (d[k] - dmin) / FREEWAY_SMIN_K;
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
      gradeRunW[slot] += h * h;
      gradeRunS[slot] += h * h * (along[k] + shift);
      continue;
    }
    const segLen = Math.hypot(seg[k * 4 + 2] - seg[k * 4], seg[k * 4 + 3] - seg[k * 4 + 1]) || 1;
    sum += h * h * segmentGrade(seg[k * 4], seg[k * 4 + 1], seg[k * 4 + 2], seg[k * 4 + 3], t[k] + shift / segLen);
    wsum += h * h;
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
