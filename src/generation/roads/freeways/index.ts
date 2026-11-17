import { smoothstep } from "../../../utils/math";
import { dropOldestHalf } from "../../cache/utils";
import { domainConfig } from "../../store";
import { unwarp } from "../../utils";
import type { BiomeContext, Wall, Zone } from "../../types";
import { groundUnderRoadAt, terrainOnlyAt, blendedTerrainAt } from "../..";
import { cityWallsOf, getBiomeContext } from "../../zones";
import { FREEWAY_SMIN_K } from "./network/constants";
import type { FreewayRun } from "./network/types";
import { collectRunCandidates, networkOf, pushSegCandidate, segCandidates, nearestRun } from "./network";
import { isLakeBiome } from "../../water/lakes/params";
import { GRADE_STEP, WET_BRIDGE_POINTS, PROFILE_REACH, FREEWAY_MAX_GRADE, GRADE_TAPS, GRADE_TAP_WEIGHTS, SHARED_END_FADE, FREEWAY_GRADE_RAMP, ROAD_PUSH_SMOOTH, BELT_FIELD_HANDOFF, BELT_STRAIGHT_REACH, FREEWAY_FIELD_REACH, FREEWAY_MERGE_CLEAR, ROAD_PUSH_CAP, ROAD_RIVER_RAMP, APPROACH_WIDEN, APPROACH_SHOULDER } from "./constants";
import type { RunProfile } from "./types";
import { runRiverYield } from "../../bridges/constants";
import { riverMouthShare } from "../../water/joins";
import { carveRiverChannel, riverWaterBand } from "../../water/channel";
import { riverQuay, riverQuayAt } from "../../water/rivers/field";
import type { BankRelief } from "../../water/types";
import { CITY_QUAY_INNER_CAP, NO_ROAD_DISTANCE } from "../constants";
import { cityCurbDip } from "../utils";
import { wallDrownedAt } from "../city";

/**
 * The GRADE a freeway off the city rides (computeVertexData step 5): one height per centerline
 * point, flat across the road, blended by distance over every segment holding a nearest point (the
 * nearest point alone jumps between the two legs inside a bend, between runs at a hub and between the
 * belt and a run leaving it).
 *
 * An inter-city RUN rides its PROFILE: the road-free ground as drawn (river walls included), the
 * lowest across the road, never climbed or descended steeper than FREEWAY_MAX_GRADE (45°) — lowered to
 * the ground wherever the old centerline grade stood over it, and cut into any slope steeper than the
 * limit (Evan: "dont raise the terrain for roads. Instead, lower the roads to the mountain"). The ground
 * is probed by whole pipeline evaluations, so a vertex fetches its run's grade at step 0.
 *
 * The BELT's outer half rides the terrain at its wall centerline with that point's OWN wall pass
 * (terrainOnlyAt): its inner half is the city's rim, at the city's grade there. Both are sampled on a
 * canonical lattice of GRADE_STEP points per segment (cached, a pure function of the segment), smoothed
 * along the run over ±2 GRADE_STEP.
 */

const gradeSamples = new Map<string, number>();

/** The centerline terrain at fraction f of a warped segment, from its GRADE_STEP lattice (canonical:
 *  the same samples from either direction) — the BELT's grade (a run's is its profile, below). */
const segmentGrade = (ax: number, az: number, bx: number, bz: number, f: number): number => {
  if (bx < ax || (bx === ax && bz < az)) return segmentGrade(bx, bz, ax, az, 1 - f);
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / GRADE_STEP));
  const u = Math.max(0, Math.min(1, f)) * n;
  const k = Math.min(n - 1, Math.floor(u));
  const sample = (i: number): number => {
    const key = `${ax},${az},${bx},${bz},${i}`;
    let g = gradeSamples.get(key);
    if (g === undefined) {
      if (gradeSamples.size > 200000) dropOldestHalf(gradeSamples);
      const p = unwarp(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      g = terrainOnlyAt(p.x, p.z);
      gradeSamples.set(key, g);
    }
    return g;
  };
  const g0 = sample(k);
  return g0 + (sample(k + 1) - g0) * (u - k);
};
/** Road-free ground per canonical lattice point (keyed as segmentGrade's): the lowest across the road. */
const groundSamples = new Map<string, number>();
const runProfiles = new WeakMap<FreewayRun, RunProfile>();

const profileOf = (run: FreewayRun): RunProfile => {
  let prof = runProfiles.get(run);
  if (prof) return prof;
  const p = run.pts;
  const segs = p.length / 2 - 1;
  const base = new Int32Array(segs);
  const count = new Int32Array(segs);
  let total = 1;
  for (let i = 0; i < segs; i++) {
    count[i] = Math.max(1, Math.ceil(Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]) / GRADE_STEP));
    base[i] = total - 1;
    total += count[i];
  }
  const key: string[] = new Array(total);
  const px = new Float64Array(total);
  const pz = new Float64Array(total);
  const nx = new Float64Array(total);
  const nz = new Float64Array(total);
  const arc = new Float64Array(total);
  for (let i = 0; i < segs; i++) {
    let ax = p[i * 2];
    let az = p[i * 2 + 1];
    let bx = p[i * 2 + 2];
    let bz = p[i * 2 + 3];
    // Canonical orientation: two runs sharing a wall (or one walked the other way) share its points.
    const flip = bx < ax || (bx === ax && bz < az);
    if (flip) [ax, az, bx, bz] = [bx, bz, ax, az];
    const n = count[i];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const ci = flip ? n - j : j;
      const k = base[i] + j;
      key[k] = `${ax},${az},${bx},${bz},${ci}`;
      px[k] = ax + ((bx - ax) * ci) / n;
      pz[k] = az + ((bz - az) * ci) / n;
      nx[k] = -(bz - az) / l;
      nz[k] = (bx - ax) / l;
    }
  }
  let prev = unwarp(px[0], pz[0]);
  for (let k = 1; k < total; k++) {
    const q = unwarp(px[k], pz[k]);
    arc[k] = arc[k - 1] + Math.hypot(q.x - prev.x, q.z - prev.z);
    prev = q;
  }
  prof = { base, count, key, px, pz, nx, nz, arc, ground: new Float64Array(total).fill(NaN), profile: new Float64Array(total).fill(NaN) };
  runProfiles.set(run, prof);
  return prof;
};

/** The lowest road-free ground across the road at lattice point k — its centerline and both pavement
 *  edges, an edge a river holds not counted — or NaN where a river holds the centerline. */
const groundAt = (prof: RunProfile, k: number): number => {
  if (!Number.isNaN(prof.ground[k])) return prof.ground[k];
  let g = groundSamples.get(prof.key[k]);
  if (g === undefined) {
    if (groundSamples.size > 200000) dropOldestHalf(groundSamples);
    const half = domainConfig!.cityConfig.freewayWidth;
    const at = (off: number): number => {
      const q = unwarp(prof.px[k] + prof.nx[k] * off, prof.pz[k] + prof.nz[k] * off);
      return groundUnderRoadAt(q.x, q.z);
    };
    g = at(0);
    if (!Number.isNaN(g)) {
      for (const side of [-half, half]) {
        const e = at(side);
        if (!Number.isNaN(e)) g = Math.min(g, e);
      }
    }
    groundSamples.set(prof.key[k], g);
  }
  prof.ground[k] = g;
  return g;
};

/** The ground at lattice point k, a wet stretch bridged straight (by world arc) between the nearest dry
 *  points either side of it; NaN with neither in reach. */
const bridgedGroundAt = (prof: RunProfile, k: number): number => {
  const g = groundAt(prof, k);
  if (!Number.isNaN(g)) return g;
  const n = prof.arc.length;
  let lo = -1;
  let hi = -1;
  for (let o = 1; o <= WET_BRIDGE_POINTS && (lo < 0 || hi < 0); o++) {
    if (lo < 0 && k - o >= 0 && !Number.isNaN(groundAt(prof, k - o))) lo = k - o;
    if (hi < 0 && k + o < n && !Number.isNaN(groundAt(prof, k + o))) hi = k + o;
  }
  if (lo < 0 && hi < 0) return NaN;
  if (lo < 0) return prof.ground[hi];
  if (hi < 0) return prof.ground[lo];
  const f = (prof.arc[k] - prof.arc[lo]) / (prof.arc[hi] - prof.arc[lo] || 1);
  return prof.ground[lo] + (prof.ground[hi] - prof.ground[lo]) * f;
};

/** The run's PROFILE at lattice point k: the highest grade that never stands above the ground along the run
 *  and never climbs steeper than FREEWAY_MAX_GRADE — the least, over the points within PROFILE_REACH, of
 *  their ground + FREEWAY_MAX_GRADE × the arc between. It only CUTS: a run never stands on a fill, and up a
 *  slope steeper than the limit it is carved into the hill. A pure function of the ground in reach, so every
 *  run object holding these points (each cell's network walks its own) lays the same road. */
const profileAt = (prof: RunProfile, k: number): number => {
  if (!Number.isNaN(prof.profile[k])) return prof.profile[k];
  const n = prof.arc.length;
  let best = Infinity;
  for (let o = k; o >= 0 && prof.arc[k] - prof.arc[o] <= PROFILE_REACH; o--) {
    const g = bridgedGroundAt(prof, o);
    if (!Number.isNaN(g)) best = Math.min(best, g + FREEWAY_MAX_GRADE * (prof.arc[k] - prof.arc[o]));
  }
  for (let o = k + 1; o < n && prof.arc[o] - prof.arc[k] <= PROFILE_REACH; o++) {
    const g = bridgedGroundAt(prof, o);
    if (!Number.isNaN(g)) best = Math.min(best, g + FREEWAY_MAX_GRADE * (prof.arc[o] - prof.arc[k]));
  }
  const v = best < Infinity ? best : NaN;
  prof.profile[k] = v;
  return v;
};

/** A run's profile at arc s (warped), or its centerline terrain where no ground is in reach. */
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
  const f = len > 0 ? (c - cum[lo]) / len : 0;
  const prof = profileOf(run);
  const n = prof.count[lo];
  const u = Math.max(0, Math.min(1, f)) * n;
  const j = Math.min(n - 1, Math.floor(u));
  const a = profileAt(prof, prof.base[lo] + j);
  const b = profileAt(prof, prof.base[lo] + j + 1);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    const p = run.pts;
    return segmentGrade(p[lo * 2], p[lo * 2 + 1], p[hi * 2], p[hi * 2 + 1], f);
  }
  return a + (b - a) * (u - j);
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
  if (!isLakeBiome(ctx.zone.biome) && withRuns) collectRunCandidates(px, pz, networkOf(ctx).freeways, reach);
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
  // Copied out first: a run's profile probes the ground, whose own belt grade comes back through here.
  const runs = gradeRuns.slice();
  const runW = gradeRunW.slice();
  const runS = gradeRunS.slice();
  gradeRuns.length = 0;
  gradeRunW.length = 0;
  gradeRunS.length = 0;
  for (let o = 0; o < runs.length; o++) {
    sum += runW[o] * runGrade(runs[o], runS[o] / runW[o]);
    wsum += runW[o];
  }
  return wsum > 0 ? sum / wsum : NaN;
};

/** The grade samples are terrain values: stale across an init (a domain switch). The per-run lattices
 *  are keyed by run objects, which the network cache rebuilds. */
export const clearFreewayGrades = (): void => {
  gradeSamples.clear();
  groundSamples.clear();
};

/**
 * Step 5 of computeVertexData (CLAUDE.md "Inter-city freeways and bridges"): the freeways OUTSIDE the
 * city — the inter-city runs and the outer half of every city's belt — graded, curb-dipped and given
 * the city's normalized road field, yielding to rivers, so the city road shader paints them as one
 * surface with the city's rim.
 */

/** A smooth maximum of a road's field and the river's push on it; the rounding fades in with the push
 *  itself, so where the push begins the field is exactly the road's. */
const smoothMaxRoad = (a: number, push: number): number => {
  const k = ROAD_PUSH_SMOOTH * smoothstep(0, ROAD_PUSH_SMOOTH, push);
  if (k <= 0) return Math.max(a, push);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (push - a)) / k));
  return a + (push - a) * h + k * h * (1 - h);
};

/** The nearest city wall — the belt seen from OUTSIDE the city: distance (the belt's: step 2 pushes it
 *  off a drowned wall), the wall's own distance, along coordinate, closest point. */
export const nearestCityWall = { distance: Infinity, wall: Infinity, along: 0, x: 0, z: 0 };
export const findNearestCityWall = (px: number, pz: number, walls: Wall[], out: typeof nearestCityWall = nearestCityWall): void => {
  out.distance = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < out.distance) {
      out.distance = d;
      out.wall = d;
      out.along = t * Math.sqrt(lenSq) + w.sx + w.sz;
      out.x = cx;
      out.z = cz;
    }
  }
};

/** The real distance (warped) from a warped point to the nearest wall of a road-bearing biome — the
 *  belt's centerline, findNearestCityWall's distance — as a pure query: the vertex in progress keeps its
 *  own nearestCityWall. */
const wallQuery = { distance: Infinity, wall: Infinity, along: 0, x: 0, z: 0 };
export const cityWallDistance = (x: number, z: number): number => {
  findNearestCityWall(x, z, cityWallsOf(getBiomeContext({ x, z })), wallQuery);
  return wallQuery.distance;
};
/** The belt's road field beside a river, `normalized` (street units) and `wall` (real units) off its
 *  wall: ON the wall exactly the city's (getCityTerrain: the belt's field lerped toward the quay's own
 *  by its river-side fade), so the pavement's edges (7, 8, 12) and the curb dip cross the wall at the
 *  same distances — a smooth maximum alone stood the curb 0.15u apart there — and off it a smooth
 *  maximum (the city's lerp, carried on, would draw the quay's sidewalk band 70u into the grass). */
const beltQuayField = (normalized: number, wall: number): number => {
  const rv = domainConfig!.river;
  const rw = domainConfig!.cityConfig.roadWidth;
  const quayOffset = (rv.halfWidth + rv.bank) * riverQuay.factor + rw;
  if (riverQuay.distance >= quayOffset) return normalized;
  const only = Math.min(CITY_QUAY_INNER_CAP, quayOffset - riverQuay.distance);
  const riverSide = 1 - smoothstep(quayOffset - rw, quayOffset - rw * 0.5, riverQuay.distance);
  const cityRule = normalized + (only - normalized) * riverSide;
  return cityRule + (smoothMaxRoad(normalized, only * riverSide) - cityRule) * smoothstep(0, BELT_FIELD_HANDOFF, wall);
};

/** What gradeOffCityFreeway computed for the current vertex (read right after the call). */
export const offCityRoad = { height: 0, roadField: NO_ROAD_DISTANCE, freewayField: NO_ROAD_DISTANCE, freewayAlong: 0, laneEndGap: Infinity, approachDelta: 0 };

/** Step 5: the freeways OUTSIDE the city — the inter-city runs and the OUTER HALF of every city's belt
 *  (centered on the wall) — as one grade, one curb dip and one normalized road field, so the city road
 *  shader paints them as one surface with the city's rim. Reads step 2's nearestRun / nearestCityWall /
 *  roadReal / roadGrade, and step 4's channel at the vertex (its levee relief and depth scale: the belt's
 *  outer half is carved by the river like any ground), and writes offCityRoad. */
export const gradeOffCityFreeway = (
  height: number,
  cvx: number,
  cvz: number,
  own: Zone,
  ctx: BiomeContext,
  roadReal: number,
  roadGrade: number,
  distanceToRiver: number,
  riverFactor: number,
  riverSurface: number,
  lakeLevel: number,
  bank: BankRelief,
  channelDepth: number,
): void => {
  const river = domainConfig!.river;
  const cityCfg = domainConfig!.cityConfig;
  const fw = cityCfg.freewayWidth;
  const riverReach = river.halfWidth + river.bank;
  const waterBand = riverWaterBand(river);
  let roadField = NO_ROAD_DISTANCE;
  let freewayField = NO_ROAD_DISTANCE;
  let freewayAlong = 0;
  let laneEndGap = Infinity;
  let approachDelta = 0;
  // Near a river: the belt's STRAIGHT river distance (the yield below), and whether its wall is
  // drowned — then the city's WATERFRONT carries the belt on (getCityTerrain) and this outer half,
  // inside the waterfront's band, keeps no lane paint of its own.
  const beltDist = nearestCityWall.distance;
  let beltStraight = Infinity;
  let beltDrowned = false;
  if (distanceToRiver < riverReach + BELT_STRAIGHT_REACH && beltDist < FREEWAY_FIELD_REACH) {
    riverQuayAt(cvx, cvz);
    if (riverQuay.distance < Infinity) {
      beltStraight = riverQuay.distance / riverQuay.factor;
      beltDrowned = wallDrownedAt(nearestCityWall.x, nearestCityWall.z) > 0.5;
    }
  }
  const onBelt = beltDist < nearestRun.distance;
  // Where the road yields to a river: the belt's outer half across the whole footprint, an inter-city
  // RUN only near the water (runRiverYield — a run grazing a river's outer bank stays a road).
  // Blended where the two roads meet, so the field never jumps.
  const runShare = smoothstep(-8, 8, beltDist - nearestRun.distance);
  const yieldAt = riverReach + (runRiverYield() - riverReach) * runShare;
  // The belt also yields by the STRAIGHT river distance, as the city's side of it does (quay and
  // waterfront): by the meandered one alone, a strip of belt stands in the sand where the channel
  // wanders off.
  const roadRiver = beltStraight < Infinity ? Math.min(distanceToRiver, distanceToRiver + (beltStraight - distanceToRiver) * (1 - runShare)) : distanceToRiver;
  const roadChannel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, yieldAt, roadRiver);
  if (distanceToRiver < Infinity) laneEndGap = (roadRiver - yieldAt) * riverFactor;
  const roadAlong = onBelt ? nearestCityWall.along : nearestRun.along;
  const roadPx = onBelt ? nearestCityWall.x : nearestRun.x;
  const roadPz = onBelt ? nearestCityWall.z : nearestRun.z;
  // Where a run meets the belt, neither carries lane paint (the mouth of the merge).
  const merging = nearestRun.distance < fw + FREEWAY_MERGE_CLEAR && beltDist < fw + FREEWAY_MERGE_CLEAR;
  // Written CONTINUOUSLY out to FREEWAY_FIELD_REACH: the shader's corridor mask (8–9.5 street units)
  // interpolates it per vertex, so a NO_ROAD_DISTANCE beside a 9 would alias the corridor's edge into the grid.
  if (roadReal < FREEWAY_FIELD_REACH) {
    let normalized = roadReal * (cityCfg.roadWidth / fw);
    // Where the road yields to the river it is on a DECK: its field is pushed past the pavement band
    // so the ground under it shows sand. The push ramps in LINEARLY over the zone's last
    // ROAD_RIVER_RAMP units, inside the deck's cover (a hard jump, or a ramp flattening near the
    // sidewalk's edge, steps along the LOD triangles), and joins the road's field by a SMOOTH maximum
    // (a plain max() creases it the same way).
    const pushFull = cityCfg.roadWidth + 6;
    const runPush = distanceToRiver < yieldAt ? Math.min(ROAD_PUSH_CAP, (pushFull * (yieldAt - distanceToRiver)) / ROAD_RIVER_RAMP) : 0;
    const runField = runPush > 0 ? smoothMaxRoad(normalized, runPush) : normalized;
    // The BELT gives way exactly as the city's side of it does (getCityTerrain's quay river side: by
    // the straight river distance, a unit per unit past the bank's edge), so its pavement's edges
    // (7, 8, 12) cross the wall at the same distances on both sides.
    const beltField = beltStraight < Infinity ? beltQuayField(normalized, nearestCityWall.wall) : normalized;
    normalized = beltField + (runField - beltField) * runShare;
    if (normalized < roadField) roadField = normalized;
  }
  const graded = roadReal < fw + FREEWAY_GRADE_RAMP;
  if (graded || (roadReal < fw + APPROACH_WIDEN + APPROACH_SHOULDER && !Number.isNaN(roadGrade))) {
    // Flat across, riding the terrain along its centerline; it never fills a river channel (a deck
    // spans that). At a city wall the centerline sample is the city's own grade (weight 1 there).
    const rp = unwarp(roadPx, roadPz);
    const grade = Number.isNaN(roadGrade) ? blendedTerrainAt(rp.x, rp.z, own, ctx) : roadGrade;
    const normalized = roadReal * (cityCfg.roadWidth / fw);
    const dip = cityCurbDip(normalized);
    // The road as a deck landing's approach lays it (step 7, bridgeApproachAt): the same grade and curb,
    // NOT giving way to the river, and flat out past the deck's sides. The yield follows the vertex's
    // own river distance, so where a river meets the road obliquely it crosses the road diagonally —
    // half the road at its grade, half carved down the bank — and the deck, wider than the road's flat,
    // sat on its falling shoulder: pits and mounds in front of a cut end, a trench under a ramp.
    const approach = height + (grade - dip - height) * (1 - smoothstep(fw + APPROACH_WIDEN, fw + APPROACH_WIDEN + APPROACH_SHOULDER, roadReal));
    if (graded) {
      const ramp = 1 - smoothstep(fw, fw + FREEWAY_GRADE_RAMP, roadReal);
      const runTarget = height + (grade - dip - height) * ramp * roadChannel;
      // A RUN only cuts (its profile already lies under the ground across its pavement): its shoulder
      // never fills where the ground falls away beside it. The belt keeps its grade: its inner half is
      // the city's rim.
      const runCut = Math.min(height, runTarget);
      if (runShare < 1 && (beltStraight < Infinity || !Number.isNaN(riverSurface))) {
        // The belt's OUTER half beside a river is what the city's inner half is at the wall: the grade
        // with the curb dip of the quay-aware field, carved by the river like any city ground (the
        // bank blends into the road, a mouth only deepens) — yielding by roadChannel instead stood the
        // outer half up to 2.7u off the city's side of the wall.
        const beltDip = cityCurbDip(beltStraight < Infinity ? beltQuayField(normalized, nearestCityWall.wall) : normalized);
        let ground = grade - beltDip;
        if (!Number.isNaN(riverSurface)) {
          const carved = carveRiverChannel(ground, distanceToRiver, riverSurface, riverFactor, bank, channelDepth);
          const mouth = riverMouthShare(ground, lakeLevel);
          ground = mouth > 0 ? carved + (Math.min(carved, ground) - carved) * mouth : carved;
        }
        const beltHeight = height + (ground - height) * ramp;
        height = runShare > 0 ? beltHeight + (runCut - beltHeight) * runShare : beltHeight;
      } else height = runTarget + (runCut - runTarget) * runShare;
      // No lane paint on the riverbed under a deck, nor in a merge.
      if (roadChannel > 0.999 && !merging && !(onBelt && beltDrowned)) {
        freewayField = roadReal;
        freewayAlong = roadAlong;
      }
    }
    // (Not over a lake: a causeway's approach would fill the lakebed beside it.)
    if (!isLakeBiome(own.biome)) approachDelta = approach - height;
  }
  offCityRoad.height = height;
  offCityRoad.roadField = roadField;
  offCityRoad.freewayField = freewayField;
  offCityRoad.freewayAlong = freewayAlong;
  offCityRoad.laneEndGap = laneEndGap;
  offCityRoad.approachDelta = approachDelta;
};
