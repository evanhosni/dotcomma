/** Where a deck lands on its road: the pavement test, a landed end cut along the pavement's edge,
 *  and a ramped end's fit under the road. */

import { CITY_BIOME_ID } from "../../../world/constants";
import { smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { PointCache } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";
import { warp } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { computeVertexData } from "../vertexCompute";
import { BRIDGE_CUT_BELOW_TOP, BRIDGE_CUT_FLUSH, BRIDGE_MIN_T_SIN } from "./constants";
import { axisAt, bridgeRampLength, pathMiters, pointAt } from "./deckGeometry";
import { polyDirAt, polyPointAt } from "./polyline";
import type { BridgeLanding, FreewayBridge, TeeTrim } from "./types";

/** The landed end section lies this far under the road at its highest point. */
const BRIDGE_RAMP_DIVE = 0.15;

/** Where a deck edge lies over road pavement (out to the curb strip: street units past the road's
 *  half-width) is sampled this often in from a landed end, up to this share of the deck; the ramp
 *  then reaches this far past the last such point. */
const BRIDGE_PAVED_STEP = 4;
const BRIDGE_PAVED_SHARE = 0.35;
const BRIDGE_PAVED_CURB = 1;
const BRIDGE_PAVED_RAMP_PAST = 8;

/** Every road's field is pushed off the pavement this far past a river's half-width (factor-1 units;
 *  an inter-city run's push is full from its yield line less ROAD_RIVER_RAMP, 54): no raw evaluation is
 *  needed nearer. (The water band's edge, 58, was too far: a run's curb there is still paved.) */
const BRIDGE_PAVED_RIVER_SKIP = 8;
/** A city sidewalk's outer edge past the road's half-width (street units): city_frag's sidewalk band. */
const BRIDGE_PAVED_SIDEWALK = 5;

/** Whether the road is PAVED at a world point, as the terrain draws it where no deck is: asphalt and
 *  the curb strip anywhere (road field under BRIDGE_PAVED_CURB past the half-width), and in a city the
 *  sidewalk band too. Never near a river's channel, where every road yields (a cheap test first: most
 *  of a deck lies over it). */
export const pavedAt = (x: number, z: number): boolean => {
  // Cached per exact point: the landed cuts' searches, the parapet gaps and the ramp lengths of every
  // deck (and every window that rebuilds one) ask the same points again — 30k of a 3.6 km walk's 49k
  // repeated raw evaluations, MEASURED.
  const hit = pavedCache.get(x, z);
  if (hit !== undefined) return hit === 1;
  const w = warp(x, z);
  riverFieldAt(w.x, w.z, false, false);
  const river = domainConfig!.river;
  let paved = false;
  if (!(riverSample.distance < river.halfWidth + BRIDGE_PAVED_RIVER_SKIP)) {
    const r = computeVertexDataRaw(x, z);
    const cfg = domainConfig!.cityConfig;
    paved = r.distanceToRoadCenter < cfg.roadWidth + (r.biomeId === CITY_BIOME_ID ? BRIDGE_PAVED_SIDEWALK : BRIDGE_PAVED_CURB);
  }
  pavedCache.set(x, z, paved ? 1 : 0);
  return paved;
};
const pavedCache = new PointCache(1 << 15);
export const clearPavedCache = (): void => pavedCache.clear();

/** A landed cut's road may fall this steeply (rise over run) between the bank's edge and the cut. */
const BRIDGE_LANDING_MAX_GRADE = 0.3;
/** 0: cut where the edges LAST leave the pavement; 1: where they FIRST do; 2: no cut (withCutRetry). */
let landedCutMode: 0 | 1 | 2 = 0;
export const withLandedCutMode = <T>(mode: 1 | 2, run: () => T): T => {
  landedCutMode = mode;
  try {
    return run();
  } finally {
    landedCutMode = 0;
  }
};

/** A LANDED end cut along the edge of the road's pavement, so traffic from any part of the road
 *  merges onto the deck (an oblique deck's parapet would run across the road it lands on, and its
 *  side stand as a ledge over the far lanes): the deck starts exactly
 *  where its two edges leave the pavement, its end section running between those two points at the
 *  road's own heights there, so the road simply continues onto it — no wall, no ledge, no deck lying
 *  over the road. Null where the end does not lie on pavement (the deck keeps its ramp). `path` is
 *  the chain's, `W` the deck's width. */
export const landedCut = (path: PointXZ[], cum: number[], which: 0 | 1, W: number): (TeeTrim & { y: number }) | null => {
  if (landedCutMode === 2) return null;
  const L = cum[cum.length - 1];
  // Across the deck along the lateral axis the slab is drawn with (pathMiters, interpolated like
  // axisAt): the leg's own normal would put a corner a fraction off the drawn one, the drawn edge
  // riding past the curb.
  const miters = pathMiters({ path: path.map((q, i) => ({ x: q.x, z: q.z, t: cum[i] / L })) } as FreewayBridge);
  const at = (sArc: number, lat: number): PointXZ => {
    const s = which === 0 ? sArc : L - sArc;
    const c = polyPointAt(path, cum, s);
    let k = 0;
    while (k < path.length - 2 && cum[k + 1] < s) k++;
    const u = Math.max(0, Math.min(1, (s - cum[k]) / Math.max(1e-12, cum[k + 1] - cum[k])));
    const ax = miters[k].x + (miters[k + 1].x - miters[k].x) * u;
    const az = miters[k].z + (miters[k + 1].z - miters[k].z) * u;
    return { x: c.x + ax * lat, z: c.z + az * lat };
  };
  const paved = (sArc: number, lat: number): boolean => {
    const p = at(sArc, lat);
    return pavedAt(p.x, p.z);
  };
  // Where the edge leaves the pavement for the LAST time within the landing region: a road curving
  // across the deck's side (or a sidewalk along it) past the first exit would leave the slab's edge
  // and its parapet standing over the road there.
  const edge = (lat: number): number => {
    const limit = BRIDGE_PAVED_SHARE * L;
    if (landedCutMode === 1) {
      if (!paved(0, lat)) return 0;
      let hi = BRIDGE_PAVED_STEP;
      while (hi <= limit && paved(hi, lat)) hi += BRIDGE_PAVED_STEP;
      if (hi > limit) return -1;
      let lo = hi - BRIDGE_PAVED_STEP;
      for (let it = 0; it < 6; it++) {
        const m = (lo + hi) / 2;
        if (paved(m, lat)) lo = m;
        else hi = m;
      }
      return hi;
    }
    let last = -1;
    for (let sArc = 0; sArc <= limit; sArc += BRIDGE_PAVED_STEP) if (paved(sArc, lat)) last = sArc;
    if (last < 0) return 0;
    if (last + BRIDGE_PAVED_STEP > limit) return -1;
    let lo = last;
    let hi = last + BRIDGE_PAVED_STEP;
    for (let it = 0; it < 6; it++) {
      const m = (lo + hi) / 2;
      if (paved(m, lat)) lo = m;
      else hi = m;
    }
    return hi;
  };
  // …but not deep inside the river's banks where the road, carved down the bank with the terrain, falls
  // steeply to it (a cut there would land the deck far under the road's crest, the mouth in front of
  // it a wall of asphalt). Such a cut moves out to the bank's edge, where the road is at its grade; a
  // gentle bank keeps the cut on its pavement (flush, no ledge beside the deck).
  const bankEdge = (lat: number): number => {
    const limit = BRIDGE_PAVED_SHARE * L;
    const river = domainConfig!.river;
    for (let sArc = 0; sArc <= limit; sArc += BRIDGE_PAVED_STEP) {
      const p = at(sArc, lat);
      const w = warp(p.x, p.z);
      riverFieldAt(w.x, w.z, false, false);
      if (riverSample.distance < river.halfWidth + river.bank) return Math.max(0, sArc - BRIDGE_PAVED_STEP);
    }
    return Infinity;
  };
  const clampToBank = (s: number, lat: number): number => {
    if (s <= 0) return s;
    const edgeAt = bankEdge(lat);
    if (!(edgeAt < s)) return s;
    const p = at(s, lat);
    const q = at(edgeAt, lat);
    const fall = Math.abs(computeVertexDataRaw(q.x, q.z).height - computeVertexDataRaw(p.x, p.z).height);
    return fall > BRIDGE_LANDING_MAX_GRADE * Math.max(1, s - edgeAt) ? edgeAt : s;
  };
  const sL = clampToBank(edge(W / 2), W / 2);
  const sR = clampToBank(edge(-W / 2), -W / 2);
  if (sL < 0 || sR < 0 || (sL === 0 && sR === 0)) return null;
  const PL = at(sL, W / 2);
  const PR = at(sR, -W / 2);
  const trim = (sL + sR) / 2;
  const d = polyDirAt(path, cum, which === 0 ? trim : L - trim);
  // The section's lateral axis runs from its right corner to its left (+ = left of travel), so its
  // corners are the two points where the edges leave the pavement.
  const ax = (PL.x - PR.x) / W;
  const az = (PL.z - PR.z) / W;
  if (ax * -d.z + az * d.x < BRIDGE_MIN_T_SIN) return null;
  // On the ASPHALT's height: the mouth in front of the cut is asphalt (bridgeMouthAt), the curb's rise
  // taken out of it — a cut end at the sidewalk's height would stand as a step over the road.
  const cfg = domainConfig!.cityConfig;
  const asphalt = (q: PointXZ): number => {
    const v = computeVertexData(q.x, q.z);
    return v.approachHeight - cfg.curbHeight * smoothstep(cfg.roadWidth - 2, cfg.roadWidth, v.distanceToRoadCenter);
  };
  const gL = asphalt(PL);
  const gR = asphalt(PR);
  const sweep = (W / 2) * Math.abs(ax * d.x + az * d.z);
  return { trim, sweep, axis: { x: ax, z: az, slope: (gL - gR) / W }, host: null, y: (gL + gR) / 2 - BRIDGE_CUT_FLUSH };
};

/** A landed end's ramp: the end section fitted UNDER the road across the deck's width — the ground
 *  as the terrain draws it there, cut just below the deck's own end height (computeVertexData step
 *  7) — by a straight cross-fall, then BRIDGE_RAMP_DIVE lower; and its length, reaching past every
 *  point in from the end where a deck edge still lies over road pavement. Evaluated while
 *  enumerating, where computeVertexData is the road without any cut. */
export const landingOf = (b: FreewayBridge, which: 0 | 1): BridgeLanding => {
  const p = b.path[which === 0 ? 0 : b.path.length - 1];
  const q = b.path[which === 0 ? 1 : b.path.length - 2];
  const l = Math.hypot(p.x - q.x, p.z - q.z) || 1;
  // The end section's lateral axis (+ = left of travel from path start to end), as pathMiters has it.
  const dx = which === 0 ? (q.x - p.x) / l : (p.x - q.x) / l;
  const dz = which === 0 ? (q.z - p.z) / l : (p.z - q.z) / l;
  const ax = -dz;
  const az = dx;
  const yEnd = which === 0 ? b.sy : b.ey;
  const half = b.width / 2;
  const lats = [-half, -half / 2, 0, half / 2, half];
  const ground = lats.map((lat) => Math.min(computeVertexData(p.x + ax * lat, p.z + az * lat).approachHeight, yEnd - BRIDGE_CUT_BELOW_TOP));
  const slope = (ground[4] - ground[0]) / b.width;
  let lo = Infinity;
  lats.forEach((lat, i) => (lo = Math.min(lo, ground[i] - slope * lat)));
  // How far in an edge lies over the road's pavement (an oblique landing's far lanes).
  const miters = pathMiters(b);
  let paved = 0;
  for (let sArc = BRIDGE_PAVED_STEP; sArc <= BRIDGE_PAVED_SHARE * b.length; sArc += BRIDGE_PAVED_STEP) {
    const t = which === 0 ? sArc / b.length : 1 - sArc / b.length;
    const c = pointAt(b, t);
    const a2 = axisAt(b, miters, t);
    if ([half, -half].some((lat) => pavedAt(c.x + a2.x * lat, c.z + a2.z * lat))) paved = sArc;
  }
  const base = bridgeRampLength(b);
  const ramp = paved > 0 ? Math.min(BRIDGE_PAVED_SHARE * b.length, Math.max(base, paved + BRIDGE_PAVED_RAMP_PAST)) : base;
  return { drop: lo - BRIDGE_RAMP_DIVE - yEnd, slope, ramp };
};
