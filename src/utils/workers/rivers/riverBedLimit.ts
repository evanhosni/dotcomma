/**
 * Where the RIVERBED ends (CLAUDE.md "Rivers"): the bed paint stops at the first bank steeper than the
 * shader's slope fade starts, marched outward from stations along each edge (lazily, cached per station
 * and direction, so every chunk agrees), and capRiverBed pushes the paint distance out of reach past it.
 */

import { smoothstep } from "../../math/_math";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { zoneFinal, zones } from "../zoneBlend";
import { RIVER_BED_SLOPE_START_DEG, bedYieldsToSteepGround } from "../../../world/shaders/constants";
import { RIVER_MEANDER_AMP } from "./constants";
import { bankAt, bankSample } from "./riverField";
import type { RiverEdge, RiverPiece } from "./types";

/** The bed ENDS where its bank first gets as steep as the shader starts fading it out
 *  (RIVER_BED_SLOPE_START_DEG) on ROCK (bedYieldsToSteepGround): past it the bed never resumes — by the
 *  per-pixel fade alone, wherever the bank flattened again within reach a patch of riverbed showed, cut
 *  off from the river by rock. Any other ground keeps the bed however steep its bank: capped there, it
 *  cut into the band in wedges and strips reaching the water (Evan, screenshot at (-8900, 1100)). */
const RIVER_BED_END_SLOPE = Math.tan((RIVER_BED_SLOPE_START_DEG * Math.PI) / 180);
/** The bank profile's sample spacing, real units (each sample is a wall pass, once per station). */
const RIVER_BED_MARCH_STEP = 3;
/** The paint fades out over this many factor-1 units inward of the limit (capRiverBed), at least two LOD1
 *  vertex spacings: over 4 the cut-off edge traced the triangles. */
export const RIVER_BED_CAP_FADE = 8;
/** Beside a city the bed limit is found past the river's reach, wherever a city vertex's bed distance
 *  (the straight one, RIVER_BED_FULL_INSET in) can still be inside it: the meandered field lies within
 *  the meander (2 × RIVER_MEANDER_AMP, ±10u on each axis) and a margin of it — this many REAL units
 *  past reach + inset (a fizzle's width factor of 0.2 puts that 70 factor-1 units out). A literal: a
 *  pipeline module's export read at the top level is not yet initialized in every bundle's order. */
export const RIVER_BED_LIMIT_PAST = 30;

/** Bed STATIONS per river piece (every RIVER_SEGMENT_LENGTH / 4 = 12.5u along an edge): one march per
 *  piece end missed banks that steepen between them. */
const BED_STATIONS = 4;
/** Marches in the fan past a piece's end, strictly between its two sides (30° apart). */
const BED_FAN = 5;

/** How far out (factor-1 units, the riverbed paint's distance) the bed reaches from station q of edge e
 *  (q / BED_STATIONS pieces along it) marching along (dx, dz) — the bed's own reach when the bank never
 *  gets steep within it, so a limit fades back to none along the river from a steep station to a flat
 *  one (a far "no limit" value swamped every limit it was interpolated with). The march runs from the
 *  channel's edge out to the bed's reach on the vertex field's own distance; the limit is that distance
 *  at the end of the first steep step out of the water. A function of the edge, the station and the
 *  direction only (cached by `key`), so every chunk agrees. Clobbers the wall-pass and edge scratch. */
const bedLimitCache = new Map<string, number>();
/** Per zone index, whether its ground is rock (bedYieldsToSteepGround); null until the zones are read. */
let rockZones: boolean[] | null = null;
/** The rock share of the last wall pass (bankAt's): the zones' weights summed over the rock ones. */
const rockShare = (): number => {
  let share = 0;
  for (let i = 0; i < zones.length; i++) if (rockZones![i]) share += zoneFinal[i];
  return share;
};
const bedLimitAlong = (e: RiverEdge, q: number, dx: number, dz: number, key: string): number => {
  let limit = bedLimitCache.get(key);
  if (limit !== undefined) return limit;
  if (bedLimitCache.size > 65536) dropOldestHalf(bedLimitCache);
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  limit = reach;
  rockZones ??= zones.map((z) => bedYieldsToSteepGround(domainConfig!.biomeNoiseConfigs[z.biome.id]));
  // No rock in the domain: no bank ends the bed, and nothing needs marching.
  if (!rockZones.some(Boolean)) {
    bedLimitCache.set(key, limit);
    return limit;
  }
  const k = Math.min(e.count - 1, Math.floor(q / BED_STATIONS));
  const u = q / BED_STATIONS - k;
  const step = e.len / e.count;
  const sx = e.ax + e.ux * (k + u) * step;
  const sz = e.az + e.uz * (k + u) * step;
  const f = e.widths ? e.widths[k] + (e.widths[k + 1] - e.widths[k]) * u : 1;
  let prevH = NaN;
  let prevX = 0;
  let prevZ = 0;
  for (let d = rv.halfWidth * f; d <= reach * f + RIVER_MEANDER_AMP; d += RIVER_BED_MARCH_STEP) {
    const px = sx + dx * d;
    const pz = sz + dz * d;
    // The slope across the march too (the shader fades by the whole gradient): the bank one step aside.
    bankAt(px + dz * RIVER_BED_MARCH_STEP, pz - dx * RIVER_BED_MARCH_STEP);
    const hAside = bankSample.height;
    const asideWorld = unwarp(px + dz * RIVER_BED_MARCH_STEP, pz - dx * RIVER_BED_MARCH_STEP);
    bankAt(px, pz);
    if (!(bankSample.distance < reach)) break;
    const h = bankSample.height;
    const world = unwarp(px, pz);
    if (!Number.isNaN(h)) {
      const along = Number.isNaN(prevH) ? 0 : (h - prevH) / Math.hypot(world.x - prevX, world.z - prevZ);
      const aside = Number.isNaN(hAside) ? 0 : (hAside - h) / Math.hypot(asideWorld.x - world.x, asideWorld.z - world.z);
      if (Math.hypot(along, aside) > RIVER_BED_END_SLOPE && rockShare() >= 0.5) {
        // Never inside the half-width, where the channel is: the bed limit is read only from there out.
        limit = Math.max(rv.halfWidth, bankSample.distance);
        break;
      }
    }
    prevH = h;
    prevX = world.x;
    prevZ = world.z;
  }
  bedLimitCache.set(key, limit);
  return limit;
};

/** Station q's limit on the edge's left (side +1, (−uz, ux)) or right (−1). */
const bedLimitSide = (e: RiverEdge, q: number, side: 1 | -1): number =>
  bedLimitAlong(e, q, -e.uz * side, e.ux * side, `${e.key}:${q}:${side > 0 ? "L" : "R"}`);
/** Past station q (a piece end) going out along the edge (`out` +1 past an end, −1 before a start): the
 *  fan's march m (1…BED_FAN, from the right side toward the left). Where a next piece of the edge goes
 *  on, it is nearer than this one past the end except where this piece is the wider (a pond end), and
 *  at a river's end or an edge's (a junction's wedges) nothing else is: the fan covers both. */
const bedLimitFan = (e: RiverEdge, q: number, out: 1 | -1, m: number): number => {
  const a = Math.PI * (m / (BED_FAN + 1) - 0.5);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return bedLimitAlong(e, q, e.ux * out * c - e.uz * sn, e.uz * out * c + e.ux * sn, `${e.key}:${q}:${out > 0 ? "F" : "B"}${m}`);
};

/** The bed limit of list piece j at the vertex: `t` along the piece (clamped), `sideCos` the sine of
 *  the vertex's angle off the edge (+ = left), `outCos` its cosine past a clamped end. Inside the piece,
 *  the two stations around t on the vertex's side (blended across the centerline, where no limit is
 *  reached); past an end, that end's fan by the angle, between the side limits at ±90° — continuous with
 *  the sides on the end's line. Lazily marched, so only stations some vertex needs are ever walked. */
export const bedLimitOfPiece = (p: RiverPiece, t: number, sideCos: number, outCos: number): number => {
  const e = p.edge;
  const q0 = p.index * BED_STATIONS;
  if ((t === 0 || t === 1) && outCos > 1e-9) {
    const q = t === 0 ? q0 : q0 + BED_STATIONS;
    const out = t === 0 ? -1 : 1;
    // 0 (right side) … BED_FAN + 1 (left side), one step per fan march.
    const a = (Math.atan2(sideCos, outCos) / Math.PI + 0.5) * (BED_FAN + 1);
    const i = Math.min(BED_FAN, Math.floor(a));
    const node = (m: number) => (m === 0 ? bedLimitSide(e, q, -1) : m === BED_FAN + 1 ? bedLimitSide(e, q, 1) : bedLimitFan(e, q, out, m));
    const n0 = node(i);
    return n0 + (node(i + 1) - n0) * (a - i);
  }
  const st = Math.min(BED_STATIONS - 1, Math.floor(t * BED_STATIONS));
  const w = t * BED_STATIONS - st;
  const side = smoothstep(-0.5, 0.5, sideCos);
  let limit = 0;
  if (side < 1) {
    const r0 = bedLimitSide(e, q0 + st, -1);
    limit += (r0 + (bedLimitSide(e, q0 + st + 1, -1) - r0) * w) * (1 - side);
  }
  if (side > 0) {
    const l0 = bedLimitSide(e, q0 + st, 1);
    limit += (l0 + (bedLimitSide(e, q0 + st + 1, 1) - l0) * w) * side;
  }
  return limit;
};

/** The riverbed paint distance capped at the bed's limit (riverSample.bedLimit): beyond the limit
 *  the point reads as out of the bed's reach, fading over RIVER_BED_CAP_FADE inward of it. Unchanged
 *  where no limit lies within reach (every flat bank). */
export const capRiverBed = (bed: number, limit: number): number => {
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  if (limit >= reach) return bed;
  return bed + (reach - limit) * smoothstep(limit - RIVER_BED_CAP_FADE, limit, bed);
};

export const clearRiverBedLimits = (): void => {
  bedLimitCache.clear();
  rockZones = null;
};
