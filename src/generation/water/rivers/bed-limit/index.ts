/**
 * Where the riverbed paint ENDS on steep banks (generation/water/DECISIONS.md "One bed shade", generation/README.md): the
 * shader fades the bed off steep ground by slope where the biome's riverbed YIELDS (<Material riverbed={{
 * yieldSlope }}>), but alone that let it resume as an isolated patch wherever a bank flattened again within
 * reach. So the bed ends at the first point of the CARVED bank (the whole pipeline's ground, every river
 * in it) going outward where the shader would start to hide it: steeper than the yield's first slope where
 * at least YIELD_SHARE of the ground yields, or hidden by at least HIDDEN_CUT on a blend with less — and
 * never resumes beyond it. The slope is the ground's GRADIENT (along the march and across it), as the
 * shader reads it off the normal: a bank steep across the march only hid the bed, then let it back further
 * out.
 *
 * Marched from STATIONS every STATION_STEP along each edge, both sides, a fan of five past each run end,
 * and rays round every pond disc DISC_RAY_STEP apart at its reach (its own factor-1 units: its width
 * toward the ray); lazy and cached per station, so chunk- and order-independent. Only where a yielding
 * biome is near: elsewhere there is no limit. A biome keeping its own banks never asks (its pavement keeps
 * the bed off by itself).
 */

import { smoothstep } from "../../../../utils/math";
import { dropOldestHalf } from "../../../cache/utils";
import { domainConfig } from "../../../store";
import { unwarp, warp } from "../../../utils";
import { bankGroundAt } from "../../..";
import { biomeSiteAt, getBiomeContext } from "../../../zones";
import type { SerializedBiome } from "../../../types";
import type { FieldDisc } from "../../types";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights, zones } from "../../../zones/blend";
import { riverKeepOff } from "../constants";
import { meandered, unmeander } from "../field";
import type { RiverEdge } from "../types";

const STATION_STEP = 12.5;
/** Real units between march samples. */
const MARCH_STEP = 2.5;
/** A march looks this far past the footprint (factor-1 units). */
const LIMIT_PAST = 20;
const YIELD_SHARE = 0.5;
/** On less yielding ground: the bed ends where the shader would hide this much of it (its slope fade × the
 *  yielding share). */
const HIDDEN_CUT = 0.25;
/** Inward of its limit the bed fades out over this (factor-1 units), and over at least the second where
 *  the limit is that close to the half-width: a whole fade from the half-width on let the bed back for
 *  ~14u past a steep step at the water's edge. */
const RIVER_BED_CAP_FADE = 8;
const RIVER_BED_CAP_FADE_MIN = 2;

/** Set while a march evaluates its samples: their own vertices ask for no bed limit. */
export let marchingBedLimits = 0;

const yieldingNear = (wx: number, wz: number): boolean => {
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(wx / gs);
  const cz = Math.floor(wz / gs);
  for (let ix = cx - 2; ix <= cx + 2; ix++) for (let iz = cz - 2; iz <= cz + 2; iz++) if (biomeSiteAt(ix, iz).zone.biome.bedYieldSlope) return true;
  return false;
};

const tanDeg = (deg: number): number => Math.tan((deg * Math.PI) / 180);
/** The share of the current vertex's ground whose bed yields, and the slopes it yields between (rise per
 *  unit): the yielding zones' own where they agree, else blended by their weights. */
const yielding = { share: 0, start: 0, end: 0 };
const yieldingHere = (): void => {
  let first: SerializedBiome["bedYieldSlope"] = undefined;
  let uniform = true;
  let share = 0;
  let start = 0;
  let end = 0;
  for (let i = 0; i < zones.length; i++) {
    const y = zones[i].biome.bedYieldSlope;
    if (!y) continue;
    share += zoneFinal[i];
    start += zoneFinal[i] * y[0];
    end += zoneFinal[i] * y[1];
    if (!first) first = y;
    else uniform &&= y[0] === first[0] && y[1] === first[1];
  }
  yielding.share = share;
  if (!first) return;
  yielding.start = tanDeg(uniform || !(share > 0) ? first[0] : start / share);
  yielding.end = tanDeg(uniform || !(share > 0) ? first[1] : end / share);
};

/** The world point whose MEANDERED warped position is (qx, qz) — the field measures its distances there,
 *  so a march along a straight line of that space crosses the bank the paint is drawn on — into `ground`,
 *  and with `height` the ground there. */
const ground = { x: 0, z: 0, h: 0 };
const groundOfMeandered = (qx: number, qz: number, height = true): void => {
  unmeander(qx, qz);
  const p = unwarp(meandered.x, meandered.z);
  ground.x = p.x;
  ground.z = p.z;
  ground.h = height ? bankGroundAt(p.x, p.z).height : NaN;
};
/** yieldingHere at a world point from its own wall pass alone — the zone weights a whole vertex there holds
 *  from its step 3 on, so what yieldingHere read after one — without the vertex: most samples stand on
 *  ground too little yielding to ask a slope (81% round Evan's snow pond), and their height is read only as
 *  the previous sample of one that does (generation/water/DECISIONS.md "The water pipeline's cost"). */
const yieldingAt = (x: number, z: number): void => {
  const w = warp(x, z);
  const ctx = getBiomeContext(w);
  accumulateWallFields(w.x, w.z, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  yieldingHere();
};
/** The ground's slope (rise per WORLD unit, as the shader's normal sees it) from a point and two
 *  neighbours: the warp and the meander stretch the march's steps (a 38° bank read 28° per march unit). */
const slopeOf = (x: number, z: number, h: number, x1: number, z1: number, d1: number, x2: number, z2: number, d2: number): number => {
  const ax = x1 - x;
  const az = z1 - z;
  const bx = x2 - x;
  const bz = z2 - z;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) return 0;
  const gx = ((d1 - h) * bz - (d2 - h) * az) / det;
  const gz = (ax * (d2 - h) - bx * (d1 - h)) / det;
  return Math.hypot(gx, gz);
};

/** From a warped centerline point of width `w` outward along (dx, dz) — in the field's meandered space —
 *  the factor-1 distance of the first steep step on yielding ground, or the reach (no limit). */
const march = (px: number, pz: number, dx: number, dz: number, w: number): number => {
  const rv = domainConfig!.river;
  const reach = riverKeepOff();
  if (!yieldingNear(px, pz)) return reach;
  marchingBedLimits++;
  try {
    // The previous sample's ground, read only when this one asks for a slope (NaN: not read yet).
    let first = true;
    let prev = NaN;
    let prevX = 0;
    let prevZ = 0;
    for (let r = rv.halfWidth * w; r <= (reach + LIMIT_PAST) * w; r += MARCH_STEP) {
      groundOfMeandered(px + dx * r, pz + dz * r, false);
      const { x, z } = ground;
      let h = NaN;
      yieldingAt(x, z);
      const { share, start, end } = yielding;
      // (Too little yielding ground to ever hide a quarter of the bed: no slope asked.)
      if (share >= HIDDEN_CUT && !first && Number.isNaN(prev)) prev = bankGroundAt(prevX, prevZ).height;
      if (share >= HIDDEN_CUT && !first && !Number.isNaN(prev)) {
        h = bankGroundAt(x, z).height;
        const along = Math.abs(h - prev) / Math.hypot(x - prevX, z - prevZ);
        let cut = along > start && share >= YIELD_SHARE;
        if (!cut) {
          groundOfMeandered(px + dx * r - dz * MARCH_STEP, pz + dz * r + dx * MARCH_STEP);
          const slope = slopeOf(x, z, h, prevX, prevZ, prev, ground.x, ground.z, ground.h);
          cut = (slope > start && share >= YIELD_SHARE) || smoothstep(start, end, slope) * Math.min(share, 1) >= HIDDEN_CUT;
        }
        if (cut) return Math.max(rv.halfWidth, (r - MARCH_STEP / 2) / w);
      }
      first = false;
      prev = h;
      prevX = x;
      prevZ = z;
    }
    return reach;
  } finally {
    marchingBedLimits--;
  }
};

/** The limit marched from edge e's centerline at arc s along (dx, dz). */
const marchedOn = (e: RiverEdge, s: number, dx: number, dz: number): number => {
  const widths = e.widths!;
  const f = Math.max(0, Math.min(e.count, (s * e.count) / e.len));
  const k = Math.min(e.count - 1, Math.floor(f));
  return march(e.ax + e.ux * s, e.az + e.uz * s, dx, dz, widths[k] + (widths[k + 1] - widths[k]) * (f - k));
};

/** An edge's marched limits (NaN: not yet marched): its side stations per side, and the three inner rays
 *  of the fan past each joint, per direction. Kept per edge KEY (a key string per lookup ran per vertex),
 *  so an edge rebuilt under the same key finds its marches; the oldest half of the edges is dropped. */
interface EdgeLimits {
  left: Float64Array;
  right: Float64Array;
  fans: Float64Array;
}
const MAX_EDGE_LIMITS = 4096;
const edgeLimits = new Map<string, EdgeLimits>();
const limitsOf = (e: RiverEdge): EdgeLimits => {
  let l = edgeLimits.get(e.key);
  if (!l) {
    if (edgeLimits.size >= MAX_EDGE_LIMITS) dropOldestHalf(edgeLimits);
    const stations = Math.floor(e.len / STATION_STEP) + 3;
    l = { left: new Float64Array(stations).fill(NaN), right: new Float64Array(stations).fill(NaN), fans: new Float64Array((e.count + 1) * 6).fill(NaN) };
    edgeLimits.set(e.key, l);
  }
  return l;
};

/** The side station `j` (every STATION_STEP) of edge e: side +1 is the edge's left. */
const sideStation = (e: RiverEdge, l: EdgeLimits, j: number, side: 1 | -1): number => {
  const stations = side > 0 ? l.left : l.right;
  let limit = j < stations.length ? stations[j] : NaN;
  if (Number.isNaN(limit)) {
    limit = marchedOn(e, j * STATION_STEP, -e.uz * side, e.ux * side);
    if (j < stations.length) stations[j] = limit;
  }
  return limit;
};

/** The bed limit (factor-1) for a point (qx, qz) whose plainly nearest piece of a run is piece i of
 *  edge e at projection t (`raw` before clamping); `first`/`last`: that piece ends its run there. */
export const runBedLimit = (e: RiverEdge, i: number, t: number, raw: number, first: boolean, last: boolean, qx: number, qz: number): number => {
  const l = limitsOf(e);
  const L = e.len / e.count;
  const perJoint = L / STATION_STEP;
  if ((first && raw < 0) || (last && raw > 1)) {
    // Past the run's end: between five rays fanned over the half-plane beyond it.
    const out = first && raw < 0 ? -1 : 1;
    const k = out < 0 ? i : i + 1;
    const ex = e.ax + e.ux * k * L;
    const ez = e.az + e.uz * k * L;
    const along = ((qx - ex) * e.ux + (qz - ez) * e.uz) * out;
    const across = (qx - ex) * -e.uz + (qz - ez) * e.ux;
    const ray = (m: number): number => {
      if (m === 0) return sideStation(e, l, Math.round(k * perJoint), -1);
      if (m === 4) return sideStation(e, l, Math.round(k * perJoint), 1);
      const slot = (k * 2 + (out > 0 ? 1 : 0)) * 3 + m - 1;
      let limit = l.fans[slot];
      if (Number.isNaN(limit)) {
        const a = ((m - 2) * Math.PI) / 4;
        limit = l.fans[slot] = marchedOn(e, k * L, e.ux * out * Math.cos(a) - e.uz * Math.sin(a), e.uz * out * Math.cos(a) + e.ux * Math.sin(a));
      }
      return limit;
    };
    const f = Math.max(0, Math.min(4, (Math.atan2(across, Math.max(0, along)) + Math.PI / 2) / (Math.PI / 4)));
    const m = Math.min(3, Math.floor(f));
    const a = ray(m);
    return a + (ray(m + 1) - a) * (f - m);
  }
  const s = (i + t) * L;
  const side = (qx - e.ax - e.ux * s) * -e.uz + (qz - e.az - e.uz * s) * e.ux >= 0 ? 1 : -1;
  const f = s / STATION_STEP;
  const j = Math.floor(f);
  const a = sideStation(e, l, j, side);
  return f === j ? a : a + (sideStation(e, l, j + 1, side) - a) * (f - j);
};

/** Rays round a pond stand this far apart at its reach (real units; ~10u at its waterline). */
const DISC_RAY_STEP = 2 * STATION_STEP;
/** A disc's marched rays (NaN: not yet marched), per disc: by its centre and ray count (the oldest half
 *  dropped), and on the disc object itself, so a vertex builds no key string. */
const MAX_DISC_LIMITS = 4096;
const discLimits = new Map<string, Float64Array>();
let discRays = new WeakMap<FieldDisc, Float64Array>();
const raysOf = (disc: FieldDisc): Float64Array => {
  let rays = discRays.get(disc);
  if (!rays) {
    const count = Math.max(16, Math.ceil((2 * Math.PI * (riverKeepOff() + LIMIT_PAST) * disc.width * (1 + disc.amount)) / DISC_RAY_STEP));
    const key = `${disc.x}|${disc.z}|${count}`;
    rays = discLimits.get(key);
    if (!rays) {
      if (discLimits.size >= MAX_DISC_LIMITS) dropOldestHalf(discLimits);
      discLimits.set(key, (rays = new Float64Array(count).fill(NaN)));
    }
    discRays.set(disc, rays);
  }
  return rays;
};
/** The bed limit (factor-1) round a pond disc toward warped (qx, qz): marched from its waterline outward
 *  like a river's, between the two nearest of its rays, DISC_RAY_STEP apart at its reach (16 left a cut
 *  between two rays 80u apart unseen). `widthToward` is a disc's width toward a unit direction. */
export const discBedLimit = (disc: FieldDisc, widthToward: (disc: FieldDisc, dx: number, dz: number) => number, qx: number, qz: number): number => {
  const limits = raysOf(disc);
  const rays = limits.length;
  const cx = disc.x;
  const cz = disc.z;
  const ray = (m: number): number => {
    let limit = limits[m];
    if (Number.isNaN(limit)) {
      const a = (m * 2 * Math.PI) / rays;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      limit = limits[m] = march(cx, cz, dx, dz, widthToward(disc, dx, dz));
    }
    return limit;
  };
  const f = ((Math.atan2(qz - cz, qx - cx) / (2 * Math.PI)) * rays + rays) % rays;
  const m = Math.floor(f);
  const a = ray(m);
  return a + (ray((m + 1) % rays) - a) * (f - m);
};

/** The bed paint distance capped at a bed limit: unchanged inward of the fade, pushed out of the paint's
 *  reach by the limit and beyond it — the fade never reaching inside the half-width (a limit inside it
 *  ends the bed just past it). */
export const capRiverBed = (distance: number, limit: number): number => {
  const rv = domainConfig!.river;
  const reach = riverKeepOff();
  if (!(limit < reach)) return distance;
  const start = Math.max(rv.halfWidth, limit - RIVER_BED_CAP_FADE);
  const t = smoothstep(start, Math.max(limit, start + RIVER_BED_CAP_FADE_MIN), distance);
  return t > 0 ? Math.max(distance, distance + (reach - distance) * t) : distance;
};

export const clearBedLimits = (): void => {
  edgeLimits.clear();
  discLimits.clear();
  discRays = new WeakMap();
};
