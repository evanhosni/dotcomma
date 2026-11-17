import { dropOldestHalf } from "../../../cache/utils";
import { domainConfig } from "../../../store";
import { biomeNoiseHeight, terrainNoise, unwarp } from "../../../utils";
import { biomeSiteAt, zoneAtWarped } from "../../../zones";
import { sstep01 } from "../../../zones/utils";
import { pieceBuilt, PIECE_BUILT, PIECE_DRY, PIECE_GORGE, PIECE_HIGH, PIECE_MOUNTAIN, PIECE_WATER } from "../enums";
import { RIVER_GORGE_SAMPLE, RIVER_MAX_RELIEF, RIVER_MOUTH_REACH, riverKeepOff } from "../constants";
import { jointAt, junctionEdges, pieceAt, baseJointSurface, junctionBaseSurface } from "../network";
import { biomeRiverChance } from "../params";
import type { GapRules } from "../params";
import { waterGroundAt } from "../../utils";
import type { Gorge, RiverEdge, RiverJunction, JunctionGap } from "../types";
import { isLakeBiome } from "../../lakes/params";

/**
 * Which pieces of a river edge are built, before the roads have their say (generation/water/rivers/network/index.ts layer 1).
 *
 * Judged on the edge alone (ownCodes), by the edge's GAP RULES (its midpoint biome's <Rivers>: params.ts
 * GapRules): a piece deep in WATER (RIVER_MOUTH_REACH inside a water zone both ways along the river) is
 * not built, nor one on HIGH ground — read on an approximate terrain (the zone's base plus its biome relief
 * faded toward the cell's edge: the real terrain needs every biome cell's freeway network over a wide
 * window): relief over RIVER_MAX_RELIEF is a MOUNTAIN, a grade over `maxGrade`, a ridge over `maxRidge` or
 * a hillside over `maxCrossGrade` is HIGH. A HIGH gap up to `gapFill` long with river or water on both
 * sides is built anyway (the water follows the ground there); then a stretch shorter than `minStretch`
 * between two unbuilt ones is dropped as a pond blob (back to HIGH) — unless it joins water to water.
 *
 * GORGES (gorgedCodes): a gap of high ground or mountain up to `gapFill` is cut through where the REAL
 * ground rises less than `maxCarve` above the straight line between the two waters it joins, and one no
 * longer than `shortGap` whatever the rise (gorgeCut) — inside one edge (across a DRY
 * biome's pieces too), into a junction where another river goes on, or between two rivers' gaps meeting at a
 * junction with no river (the lowest ridge there sets the junction's water for every gorge at it). Each
 * junction decides from its edges' OWN codes, so every decision is a pure function of the junction.
 */

/** The approximate terrain at a warped point: the nearest biome site's zone, its base noise plus its
 *  biome relief scaled by the zone's presence (from the distance to the nearest foreign site's bisector;
 *  a site of its relief join is not foreign: generation/zones/blend/index.ts joinReliefs). */
const proxyAt = (wx: number, wz: number): { h: number; relief: number } => {
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(wx / gs);
  const cz = Math.floor(wz / gs);
  let own = biomeSiteAt(cx, cz);
  let ownD = (own.x - wx) ** 2 + (own.z - wz) ** 2;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const s = biomeSiteAt(ix, iz);
      const d = (s.x - wx) ** 2 + (s.z - wz) ** 2;
      if (d < ownD) {
        own = s;
        ownD = d;
      }
    }
  }
  const zone = own.zone;
  let presence = 1;
  if (!zone.crisp) {
    let foreign = Infinity;
    for (let ix = cx - 2; ix <= cx + 2; ix++) {
      for (let iz = cz - 2; iz <= cz + 2; iz++) {
        const s = biomeSiteAt(ix, iz);
        if ((s.zone === zone && zone.biome.joinable) || (zone.reliefGroup >= 0 && s.zone.reliefGroup === zone.reliefGroup)) continue;
        const sep = Math.hypot(s.x - own.x, s.z - own.z);
        if (sep > 0) foreign = Math.min(foreign, ((s.x - wx) ** 2 + (s.z - wz) ** 2 - ownD) / (2 * sep));
      }
    }
    presence = sstep01(foreign / zone.heightPresenceWidth);
  }
  const w = unwarp(wx, wz);
  const base = terrainNoise(zone.baseNoise, w.x, w.z);
  // A water zone reads as its base: the bowl it digs is under the level, not ground the river is on.
  if (isLakeBiome(zone.biome)) return { h: base, relief: 0 };
  const noise = domainConfig!.biomeNoiseConfigs[zone.biome.id];
  const relief = noise ? biomeNoiseHeight(noise, w.x, w.z) * presence : 0;
  return { h: base + relief, relief };
};

/** Each piece judged on the edge alone: built, in a dry biome, deep in water, a mountain or high ground. */
const classify = (e: RiverEdge): Uint8Array => {
  const { maxGrade, maxRidge, maxCrossGrade } = e.rules;
  const n = e.count;
  const L = e.len / n;
  const reach = riverKeepOff();
  const codes = new Uint8Array(n);
  // Water on a lattice along the edge, and past its ends its junction's.
  const step = 25;
  const m0 = Math.floor(-RIVER_MOUTH_REACH / step);
  const water: boolean[] = [];
  for (let m = m0; m * step <= e.len + RIVER_MOUTH_REACH; m++) {
    const s = m * step;
    water.push(s <= 0 ? e.a.water : s >= e.len ? e.b.water : isLakeBiome(zoneAtWarped(e.ax + e.ux * s, e.az + e.uz * s).biome));
  }
  const deep = (i: number): boolean => {
    for (let m = Math.ceil((i * L - RIVER_MOUTH_REACH) / step); m <= Math.floor(((i + 1) * L + RIVER_MOUTH_REACH) / step); m++) if (!water[m - m0]) return false;
    return true;
  };
  const joint = [];
  for (let k = 0; k <= n; k++) joint.push(proxyAt(e.ax + e.ux * L * k, e.az + e.uz * L * k));
  for (let i = 0; i < n; i++) {
    if (biomeRiverChance(zoneAtWarped(e.ax + e.ux * (i + 0.5) * L, e.az + e.uz * (i + 0.5) * L).biome) === 0) {
      codes[i] = PIECE_DRY;
      continue;
    }
    if (deep(i)) {
      codes[i] = PIECE_WATER;
      continue;
    }
    const s = (i + 0.5) * L;
    const mx = e.ax + e.ux * s;
    const mz = e.az + e.uz * s;
    const half = reach * (e.a.width + ((e.b.width - e.a.width) * s) / e.len);
    const mid = proxyAt(mx, mz);
    const left = proxyAt(mx - e.uz * half, mz + e.ux * half);
    const right = proxyAt(mx + e.uz * half, mz - e.ux * half);
    if (Math.max(joint[i].relief, joint[i + 1].relief, mid.relief) > RIVER_MAX_RELIEF) {
      codes[i] = PIECE_MOUNTAIN;
      continue;
    }
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n, i + 2);
    const grade = Math.abs(joint[hi].h - joint[lo].h) / ((hi - lo) * L);
    const ridge = mid.h - Math.max(left.h, right.h);
    const cross = Math.abs(left.h - right.h) / (2 * half);
    if (grade > maxGrade || ridge > maxRidge || cross > maxCrossGrade) codes[i] = PIECE_HIGH;
  }
  return codes;
};

export const isHigh = (code: number): boolean => code === PIECE_HIGH || code === PIECE_MOUNTAIN;

/** Each maximal run of pieces passing `test`, as [first, last]. */
export const runsOf = (codes: Uint8Array, test: (code: number) => boolean): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < codes.length; ) {
    if (!test(codes[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < codes.length && test(codes[j + 1])) j++;
    out.push([i, j]);
    i = j + 1;
  }
  return out;
};

/** The edge's OWN codes: classified, steep gaps filled, pond blobs dropped. */
export const ownCodes = (e: RiverEdge): Uint8Array => {
  if (e.own) return e.own;
  const codes = classify(e);
  const { gapFill, minStretch } = e.rules;
  const n = e.count;
  const L = e.len / n;
  const wet = (i: number): boolean => (i < 0 ? e.a.water : i >= n ? e.b.water : codes[i] === PIECE_BUILT || codes[i] === PIECE_WATER);
  // A run of steep ground only (a mountain piece ends it), so water beside it in the edge borders it.
  for (const [g0, g1] of runsOf(codes, (c) => c === PIECE_HIGH)) {
    if ((g1 - g0 + 1) * L <= gapFill && wet(g0 - 1) && wet(g1 + 1)) codes.fill(PIECE_BUILT, g0, g1 + 1);
  }
  for (const [b0, b1] of runsOf(codes, (c) => c === PIECE_BUILT)) {
    if (b0 === 0 || b1 === n - 1 || (b1 - b0 + 1) * L >= minStretch) continue;
    if (codes[b0 - 1] === PIECE_WATER && codes[b1 + 1] === PIECE_WATER) continue;
    codes.fill(PIECE_HIGH, b0, b1 + 1);
  }
  e.own = codes;
  return codes;
};

/** How far the real ground rises above the straight water line from (x0, z0) at water v0 to (x1, z1) at
 *  water v1 (warped), sampled every RIVER_GORGE_SAMPLE between them: what decides a gorge, a revived edge's
 *  join and a summit's fall. */
export const riseOverWaterLine = (x0: number, z0: number, v0: number, x1: number, z1: number, v1: number): number => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / RIVER_GORGE_SAMPLE));
  let rise = -Infinity;
  for (let i = 1; i < n; i++) rise = Math.max(rise, waterGroundAt(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n).h - (v0 + ((v1 - v0) * i) / n));
  return rise;
};
const jointX = (e: RiverEdge, k: number): number => e.ax + (e.ux * e.len * k) / e.count;
const jointZ = (e: RiverEdge, k: number): number => e.az + (e.uz * e.len * k) / e.count;
/** The rise over the water line from joint k0 (water v0) to joint k1 (water v1) of edge e. */
const gapRise = (e: RiverEdge, k0: number, v0: number, k1: number, v1: number): number => riseOverWaterLine(jointX(e, k0), jointZ(e, k0), v0, jointX(e, k1), jointZ(e, k1), v1);

/** Whether a gap `length` long is cut as a gorge, `rise` measuring its real ground over the water line: a
 *  short one (`shortGap`) always, its rise never measured; a longer one under `maxCarve`. */
const gorgeCut = (shortGap: number, maxCarve: number, length: number, rise: () => number): boolean => length <= shortGap || rise() < maxCarve;

/** A gap rule for a pair of gaps meeting at a junction from two edges: the stricter (smaller) of theirs. */
export const pairRule = (g1: JunctionGap, g2: JunctionGap, rule: "gapFill" | "maxCarve" | "shortGap" | "summitMaxGap"): number => Math.min(g1.e.rules[rule], g2.e.rules[rule]);
export const gapFromJunction = (e: RiverEdge, j: RiverJunction, codes: Uint8Array, maxLength: (rules: GapRules) => number): JunctionGap | null => {
  const first = pieceAt(e, j);
  const dir = first === 0 ? 1 : -1;
  let i = first;
  while (i >= 0 && i < e.count && isHigh(codes[i])) i += dir;
  if (i === first || i < 0 || i >= e.count || !pieceBuilt(codes[i])) return null;
  const length = (Math.abs(i - first) * e.len) / e.count;
  return length > maxLength(e.rules) ? null : { e, stretch: dir > 0 ? i : i + 1, junction: jointAt(e, j), length };
};
/** Whether any river of junction j is built at it in a layer. */
export const builtAtJunction = (j: RiverJunction, layer: (e: RiverEdge) => Uint8Array): boolean => junctionEdges(j).some((e) => pieceBuilt(layer(e)[pieceAt(e, j)]));
/** Every pair of a junction's gaps, each once. */
export const gapPairs = function* (gaps: readonly JunctionGap[]): Generator<[JunctionGap, JunctionGap]> {
  for (let p = 0; p < gaps.length; p++) for (let q = p + 1; q < gaps.length; q++) yield [gaps[p], gaps[q]];
};

/** What a junction decides: the gorges its gaps get (by edge key), and — where no river goes on there —
 *  the pair whose line sets its water. */
interface JunctionGorges {
  gorges: Map<string, JunctionGap>;
  pair: [JunctionGap, JunctionGap] | null;
}
const junctionDecisions = new Map<string, JunctionGorges>();
export const junctionGorges = (j: RiverJunction): JunctionGorges => {
  const cached = junctionDecisions.get(j.key);
  if (cached) return cached;
  const out: JunctionGorges = { gorges: new Map(), pair: null };
  const gaps = junctionEdges(j)
    .map((e) => gapFromJunction(e, j, ownCodes(e), (r) => r.gapFill))
    .filter((g): g is JunctionGap => g !== null);
  const base = (g: JunctionGap) => baseJointSurface(g.e, g.stretch);
  if (builtAtJunction(j, ownCodes)) {
    const water = junctionBaseSurface(j);
    for (const g of gaps) if (gorgeCut(g.e.rules.shortGap, g.e.rules.maxCarve, g.length, () => gapRise(g.e, g.stretch, base(g), g.junction, water))) out.gorges.set(g.e.key, g);
  } else {
    let best = Infinity;
    for (const [g1, g2] of gapPairs(gaps)) {
      if (g1.length + g2.length > pairRule(g1, g2, "gapFill")) continue;
      const v1 = base(g1);
      const v2 = base(g2);
      const atJunction = v1 + ((v2 - v1) * g1.length) / (g1.length + g2.length);
      const rise = Math.max(gapRise(g1.e, g1.stretch, v1, g1.junction, atJunction), gapRise(g2.e, g2.stretch, v2, g2.junction, atJunction));
      if (!gorgeCut(pairRule(g1, g2, "shortGap"), pairRule(g1, g2, "maxCarve"), g1.length + g2.length, () => rise)) continue;
      out.gorges.set(g1.e.key, g1);
      out.gorges.set(g2.e.key, g2);
      if (rise < best) {
        best = rise;
        out.pair = [g1, g2];
      }
    }
  }
  if (junctionDecisions.size > 16384) dropOldestHalf(junctionDecisions);
  junctionDecisions.set(j.key, out);
  return out;
};

/** The edge's codes with its gorges cut (in the edge, and at either junction), and the gorges' joints. */
export const gorgedCodes = (e: RiverEdge): Uint8Array => {
  if (e.gorged) return e.gorged;
  const own = ownCodes(e);
  const codes = own.slice();
  const gorges: Gorge[] = [];
  const L = e.len / e.count;
  // A DRY biome between two built stretches is crossed like a ridge: two ponds facing each other across a
  // few hundred units of an oasis's gentle dunes read as a river cut for nothing (Evan, Nov 2026). It
  // still keeps out every stretch that would start, end or run in it.
  for (const [g0, g1] of runsOf(own, (c) => isHigh(c) || c === PIECE_DRY)) {
    const length = (g1 - g0 + 1) * L;
    if (g0 === 0 || g1 === e.count - 1 || length > e.rules.gapFill) continue;
    if (!gorgeCut(e.rules.shortGap, e.rules.maxCarve, length, () => gapRise(e, g0, baseJointSurface(e, g0), g1 + 1, baseJointSurface(e, g1 + 1)))) continue;
    codes.fill(PIECE_GORGE, g0, g1 + 1);
    gorges.push({ k0: g0, k1: g1 + 1, junctionEnd: -1 });
  }
  for (const j of [e.a, e.b]) {
    const g = junctionGorges(j).gorges.get(e.key);
    if (!g) continue;
    const atA = g.junction === 0;
    codes.fill(PIECE_GORGE, atA ? 0 : g.stretch, atA ? g.stretch : e.count);
    gorges.push(atA ? { k0: 0, k1: g.stretch, junctionEnd: 0 } : { k0: g.stretch, k1: e.count, junctionEnd: 1 });
  }
  e.gorges = gorges;
  e.gorged = codes;
  return codes;
};

export const clearPieceRules = (): void => junctionDecisions.clear();
