/**
 * THE ROAD WINS (rivers/network.ts layer 2, water/DECISIONS.md "The road layer"). Only where a road-bearing
 * biome lies within freeway-link reach of the edge; every judgement reads the edge's own pieces and the
 * roads near them (../utils.ts roadPathsNear), never the river field, which reads this layer. The deck
 * rules it judges by are the bridge builder's (../utils.ts), applied in its own code.
 *
 *  - ALONG: pieces under a run, belt or city arterial within RIVER_ROAD_ALIGN of the river inside its
 *    footprint (plus the road's half-width), in a run of RIVER_ROAD_ALONG_MIN or more, are the road's.
 *  - NO FREEWAY SEVERED: every wet stretch of a run or belt crossing the river keeps the deck rules
 *    (bridges/constants.ts: steep enough, little along the shore — a run crossing may follow it). One
 *    ending in the water (its end sample in it for certain) must tee into a decked road (one that turns
 *    no sharper than a deck may once rounded) or chain with the road it meets into one such crossing.
 *    A stretch no deck may carry makes the river give way under it, in passes until none is left.
 *    Kept: grazes, stretches beside a deckable one, a belt the waterfront carries (along the river) and
 *    a city arterial the quay carries (all but a crossing too shallow for a deck; one a deck may carry
 *    is decked, and hosts tees).
 *  - NO RIVER END UNDER A ROAD (finalCodes): an end retracts piece by piece while a run or belt
 *    centerline (not a belt's decked crossing, nor a belt the waterfront carries along the river), or a
 *    too-shallow arterial crossing, lies inside the end piece's footprint (at the river's own width, its
 *    end shape left out); an end at a junction every other river gave up retracts at most
 *    RIVER_JUNCTION_RETRACT pieces, and a mouth (the river running on into deep water) not at all.
 */

import { distanceToSegment } from "../../../math";
import { domainConfig } from "../../computeConfig";
import { zoneAtWarped } from "../../voronoi";
import {
  BRIDGE_ALONG_ALIGN,
  BRIDGE_MAX_ALONG_SHORE,
  BRIDGE_MAX_TURN,
  BRIDGE_MIN_CROSSING,
  BRIDGE_WET_MERGE,
  bearsRoads,
  deckPathTurn,
  deckWidth,
  freewayHalfWidth,
  type RoadPath,
  roadPathsNear,
  roadsMayReach,
  runRiverYield,
  segIntersect,
} from "../utils";
import {
  PIECE_ROAD,
  PIECE_WATER,
  RIVER_BELT_CARRIED,
  RIVER_DECKABLE_NEAR,
  RIVER_JUNCTION_RETRACT,
  RIVER_MEANDER_AMP,
  RIVER_ROAD_ALIGN,
  RIVER_ROAD_ALONG_MIN,
  RIVER_SHAPED_MAX,
  RIVER_TEE_REACH,
  pieceBuilt,
  riverKeepOff,
} from "./constants";
import { type JunctionEnd, junctionEdges, pieceAt, stretchWidths } from "./network";
import { runsOf } from "./pieceRules";
import { climbedCodes } from "./summits";
import type { RiverEdge, RiverJunction, RiverPiece } from "./types";

/** Whether a road can reach edge e at all (cached on it). */
export const riverEdgeNearRoads = (e: RiverEdge): boolean => (e.nearRoads ??= roadsMayReach(e.ax, e.az, e.ax + e.ux * e.len, e.az + e.uz * e.len));

/** Whether another river of junction j is built there in a layer. */
const builtAt = (e: RiverEdge, j: RiverJunction, layer: (f: RiverEdge) => Uint8Array): boolean =>
  junctionEdges(j).some((f) => f.key !== e.key && pieceBuilt(layer(f)[pieceAt(f, j)]));


/** One built piece as the layer measures it (warped). */
interface Span {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  w0: number;
  w1: number;
  i: number;
}
const spansOf = (e: RiverEdge, codes: Uint8Array, widths: Float64Array): Span[] => {
  const L = e.len / e.count;
  const out: Span[] = [];
  for (let i = 0; i < e.count; i++) {
    if (pieceBuilt(codes[i])) out.push({ sx: e.ax + e.ux * L * i, sz: e.az + e.uz * L * i, ex: e.ax + e.ux * L * (i + 1), ez: e.az + e.uz * L * (i + 1), w0: widths[i], w1: widths[i + 1], i });
  }
  return out;
};
/** The nearest built span to a point: factor-1 distance, real distance, and the width factor there. */
const nearest = { dn: Infinity, d: Infinity, w: 1 };
const measure = (e: RiverEdge, spans: Span[], px: number, pz: number): typeof nearest => {
  nearest.dn = Infinity;
  nearest.d = Infinity;
  const L = e.len / e.count;
  for (const p of spans) {
    const t = Math.max(0, Math.min(1, ((px - p.sx) * e.ux + (pz - p.sz) * e.uz) / L));
    const d = Math.hypot(px - p.sx - e.ux * L * t, pz - p.sz - e.uz * L * t);
    const w = p.w0 + (p.w1 - p.w0) * t;
    if (d / w < nearest.dn) {
      nearest.dn = d / w;
      nearest.d = d;
      nearest.w = w;
    }
  }
  return nearest;
};

/** How a warped polyline (path sample indices, in order) meets the edge's built centerline — each
 *  stretch extended past a river END by its half-width, not at a junction where another river goes on
 *  (the extension would run into that river's water and count a run beside a confluence twice): how
 *  many crossings, the shallowest (radians, 0 = along), and how long it follows the shore inside the
 *  footprint (within BRIDGE_ALONG_ALIGN). */
const meetOf = (e: RiverEdge, spans: Span[], path: RoadPath, idx: number[]): { count: number; angle: number; along: number } => {
  const hw = domainConfig!.river.halfWidth;
  const goesOnA = builtAt(e, e.a, climbedCodes);
  const goesOnB = builtAt(e, e.b, climbedCodes);
  const hits: { x: number; z: number }[] = [];
  let angle = Math.PI / 2;
  for (let k = 0; k < spans.length; ) {
    let m = k;
    while (m + 1 < spans.length && spans[m + 1].i === spans[m].i + 1) m++;
    const a = spans[k];
    const b = spans[m];
    const extA = a.i === 0 && goesOnA ? 0 : hw * a.w0;
    const extB = b.i === e.count - 1 && goesOnB ? 0 : hw * b.w1;
    const ax = a.sx - e.ux * extA;
    const az = a.sz - e.uz * extA;
    const bx = b.ex + e.ux * extB;
    const bz = b.ez + e.uz * extB;
    for (let q = 0; q + 1 < idx.length; q++) {
      const [i, j] = [idx[q], idx[q + 1]];
      const hit = segIntersect(path.wx[i], path.wz[i], path.wx[j], path.wz[j], ax, az, bx, bz);
      if (!hit || hits.some((h) => Math.hypot(h.x - hit.x, h.z - hit.z) < 2)) continue;
      hits.push(hit);
      const lx = path.wx[j] - path.wx[i];
      const lz = path.wz[j] - path.wz[i];
      angle = Math.min(angle, Math.acos(Math.min(1, Math.abs(lx * e.ux + lz * e.uz) / (Math.hypot(lx, lz) || 1))));
    }
    k = m + 1;
  }
  const reach = riverKeepOff();
  const cos = Math.cos(BRIDGE_ALONG_ALIGN);
  let along = 0;
  for (let q = 0; q + 1 < idx.length; q++) {
    const [i, j] = [idx[q], idx[q + 1]];
    const dx = path.wx[j] - path.wx[i];
    const dz = path.wz[j] - path.wz[i];
    const l = Math.hypot(dx, dz);
    if (l < 1e-9 || measure(e, spans, (path.wx[i] + path.wx[j]) / 2, (path.wz[i] + path.wz[j]) / 2).dn >= reach) continue;
    if (Math.abs(dx * e.ux + dz * e.uz) / l > cos) along += Math.hypot(path.x[j] - path.x[i], path.z[j] - path.z[i]);
  }
  return { count: hits.length, angle, along };
};

/** Within a deck's limit along the shore — or a run crossing: the only road between two cities, it may
 *  follow the shore on a deck that crosses. */
const alongOk = (kind: RoadPath["kind"], m: { count: number; along: number }): boolean =>
  m.along <= BRIDGE_MAX_ALONG_SHORE || (kind === "run" && m.count % 2 === 1);

/** A meeting a deck could carry across: an odd number of crossings, steeply enough, within alongOk. */
const deckableMeet = (kind: RoadPath["kind"], m: { count: number; angle: number; along: number }): boolean =>
  m.count % 2 === 1 && m.angle >= BRIDGE_MIN_CROSSING && alongOk(kind, m);

const deckable = (e: RiverEdge, spans: Span[], path: RoadPath, idx: number[]): boolean => deckableMeet(path.kind, meetOf(e, spans, path, idx));

/** A wet stretch of one road path: samples i0..i1 (wet runs BRIDGE_WET_MERGE apart merged, so `wet`
 *  says which samples are), whether each end is the road ending in the water, and whether a deck over
 *  it may host a tee. */
interface Stretch {
  path: RoadPath;
  i0: number;
  i1: number;
  wet: boolean[];
  host: boolean;
  open: [boolean, boolean];
  verdict: "keep" | "deck" | "fail";
  shallow: boolean;
}

/** Appends samples `idx` of road `from` to road `to`. */
const append = (to: RoadPath, from: RoadPath, idx: number[]): void => {
  for (const i of idx) {
    to.wx.push(from.wx[i]);
    to.wz.push(from.wz[i]);
    to.x.push(from.x[i]);
    to.z.push(from.z[i]);
  }
};

const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

/** The stretch with its dry samples either side: what a deck over it spans. */
const spanOf = (s: Stretch): number[] => range(Math.max(0, s.i0 - 1), Math.min(s.path.wx.length - 1, s.i1 + 1));
/** Whether a wet sample of the stretch lies within `r` of a warped point. */
const wetNear = (s: Stretch, x: number, z: number, r: number): boolean => {
  for (let i = s.i0; i <= s.i1; i++) if (s.wet[i] && Math.hypot(s.path.wx[i] - x, s.path.wz[i] - z) < r) return true;
  return false;
};

/** Every road path's WET stretches over the edge's spans, unjudged: a sample is wet where the terrain has
 *  the river (the meander's reach included) under the road's middle or either edge, but not where the
 *  waterfront carries a belt along the river or the quay an arterial; wet samples BRIDGE_WET_MERGE apart
 *  join one stretch. */
const wetStretchesOf = (e: RiverEdge, spans: Span[], paths: RoadPath[]): Stretch[] => {
  const reach = riverKeepOff();
  const half = deckWidth() / 2;
  const carriedCos = Math.cos(RIVER_BELT_CARRIED);
  const quayCos = Math.cos(RIVER_ROAD_ALIGN);
  // No sample past the widest footprint off the spans' box can be wet.
  const pad = reach * RIVER_SHAPED_MAX + half;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of spans) {
    x0 = Math.min(x0, p.sx, p.ex);
    x1 = Math.max(x1, p.sx, p.ex);
    z0 = Math.min(z0, p.sz, p.ez);
    z1 = Math.max(z1, p.sz, p.ez);
  }
  const out: Stretch[] = [];
  for (const path of paths) {
    const n = path.wx.length;
    if (n < 2) continue;
    const loop = Math.hypot(path.wx[0] - path.wx[n - 1], path.wz[0] - path.wz[n - 1]) < 0.01;
    const yieldAt = path.kind === "run" ? runRiverYield() : reach;
    const wet: boolean[] = [];
    for (let i = 0; i < n; i++) {
      if (path.wx[i] < x0 - pad || path.wx[i] > x1 + pad || path.wz[i] < z0 - pad || path.wz[i] > z1 + pad) {
        wet.push(false);
        continue;
      }
      const j = Math.min(n - 1, i + 1);
      const k = Math.max(0, i - 1);
      const dx = path.wx[j] - path.wx[k];
      const dz = path.wz[j] - path.wz[k];
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      let w = false;
      for (const off of [0, half, -half]) {
        const m = !w && measure(e, spans, path.wx[i] + nx * off, path.wz[i] + nz * off);
        if (m && m.d < yieldAt * m.w + RIVER_MEANDER_AMP) w = true;
      }
      const along = Math.abs(dx * e.ux + dz * e.uz) / l;
      if (w && (path.kind === "belt" ? along > carriedCos : path.kind !== "run" && along > quayCos)) w = false;
      wet.push(w);
    }
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]));
    // A road ends in the water only where its end sample is in it for certain (the meander on the far
    // side), or a run's end at a belt corner on the bank would read as in the river.
    const certainlyWet = (i: number): boolean => {
      const m = measure(e, spans, path.wx[i], path.wz[i]);
      return m.d + RIVER_MEANDER_AMP < yieldAt * m.w;
    };
    for (let i0 = 0; i0 < n; ) {
      if (!wet[i0]) {
        i0++;
        continue;
      }
      let i1 = i0;
      for (;;) {
        let next = i1 + 1;
        while (next < n && !wet[next]) next++;
        if (next < n && (next === i1 + 1 || cum[next] - cum[i1] <= BRIDGE_WET_MERGE + 1e-6)) i1 = next;
        else break;
      }
      const open: [boolean, boolean] = [i0 === 0 && !loop && certainlyWet(0), i1 === n - 1 && !loop && certainlyWet(n - 1)];
      out.push({ path, i0, i1, wet, host: false, open, verdict: "keep", shallow: false });
      i0 = i1 + 1;
    }
  }
  return out;
};

/** Each stretch's own verdict: an arterial is decked where a deck may carry it, else the quay carries it
 *  along the bank unless it crosses too shallow for one; a run or belt crossing is decked where a deck may
 *  carry it and fails where none may; one ending in the water is PENDING (served below, or it fails); one
 *  open at both ends joins nothing (the roads it meets judge themselves). Returns the decks and the pending. */
const judgeEach = (e: RiverEdge, spans: Span[], stretches: Stretch[]): { decks: Stretch[]; pending: Stretch[] } => {
  const decks: Stretch[] = [];
  const pending: Stretch[] = [];
  for (const s of stretches) {
    const m = meetOf(e, spans, s.path, spanOf(s));
    const arterial = s.path.kind === "arterial" || s.path.kind === "arterialSeg";
    const open = s.open[0] || s.open[1];
    s.shallow = m.count % 2 === 1 && m.angle < BRIDGE_MIN_CROSSING;
    if (s.open[0] && s.open[1]) continue;
    if (arterial) s.verdict = deckableMeet(s.path.kind, m) ? "deck" : open || !s.shallow ? "keep" : "fail";
    else if (open) {
      if (alongOk(s.path.kind, m)) pending.push(s);
      else s.verdict = "fail";
    } else if (m.count % 2 === 0) s.verdict = "keep";
    else s.verdict = deckableMeet(s.path.kind, m) ? "deck" : "fail";
    if (s.verdict !== "deck") continue;
    // A crossing too sharp for a deck even rounded is carried on a curve, which no road ending in the
    // water beside it can tee into.
    s.host = arterial || open || deckPathTurn(spanOf(s).map((i) => s.path.x[i]), spanOf(s).map((i) => s.path.z[i])) <= BRIDGE_MAX_TURN;
    decks.push(s);
  }
  return { decks, pending };
};

/** Whether a stretch ending in the water is SERVED: by a tee into a decked road that hosts one, or by
 *  chaining with the road it meets there (another's end, or a road running past the corner) into one
 *  crossing a deck may carry — this stretch toward its open end, then the other on from the meeting either
 *  way. */
const served = (e: RiverEdge, spans: Span[], s: Stretch, stretches: Stretch[], decks: Stretch[]): boolean => {
  for (const end of [0, 1] as const) {
    if (!s.open[end]) continue;
    const at = end === 0 ? s.i0 : s.i1;
    const x = s.path.wx[at];
    const z = s.path.wz[at];
    if (decks.some((d) => d.host && wetNear(d, x, z, RIVER_TEE_REACH))) return true;
    const mine = end === 1 ? spanOf(s) : spanOf(s).reverse();
    for (const o of stretches) {
      if (o === s) continue;
      const theirs = spanOf(o);
      const m = theirs.findIndex((i) => Math.hypot(o.path.wx[i] - x, o.path.wz[i] - z) <= BRIDGE_WET_MERGE);
      if (m < 0) continue;
      for (const on of [theirs.slice(m), theirs.slice(0, m + 1).reverse()]) {
        if (on.length < 2) continue;
        const joined: RoadPath = { kind: s.path.kind, wx: [], wz: [], x: [], z: [] };
        append(joined, s.path, mine);
        append(joined, o.path, on);
        if (deckable(e, spans, joined, range(0, joined.wx.length - 1))) return true;
      }
    }
  }
  return false;
};

/** One pass over every road near the edge: its wet stretches, judged. A served stretch is a deck another
 *  can tee into, so the pending are served until none is left to serve; the rest fail — unless beside a
 *  deck (within RIVER_DECKABLE_NEAR), which carries them. */
const judgeStretches = (e: RiverEdge, spans: Span[], paths: RoadPath[]): Stretch[] => {
  const stretches = wetStretchesOf(e, spans, paths);
  const { decks, pending } = judgeEach(e, spans, stretches);
  for (let found = true; found; ) {
    found = false;
    for (let k = pending.length - 1; k >= 0; k--) {
      if (!served(e, spans, pending[k], stretches, decks)) continue;
      pending[k].verdict = "deck";
      pending[k].host = true;
      decks.push(pending[k]);
      pending.splice(k, 1);
      found = true;
    }
  }
  for (const s of pending) s.verdict = "fail";
  for (const s of stretches) {
    if (s.verdict !== "fail") continue;
    if (decks.some((d) => d !== s && range(s.i0, s.i1).some((i) => s.wet[i] && wetNear(d, s.path.wx[i], s.path.wz[i], RIVER_DECKABLE_NEAR)))) s.verdict = "keep";
  }
  return stretches;
};

/** The ALONG rule: a piece is ALONG a road whose centerline passes within its footprint plus the
 *  road's half-width of the piece's midpoint, within RIVER_ROAD_ALIGN of the river; a run of along
 *  pieces RIVER_ROAD_ALONG_MIN or longer is the road's. Per piece, so a grid of separate crossings (the
 *  city's arterials) never reads as one long stretch: each is inside the footprint over ~2R/sin θ. */
const alongRoads = (e: RiverEdge, codes: Uint8Array, paths: RoadPath[]): void => {
  const fw = freewayHalfWidth();
  const cos = Math.cos(RIVER_ROAD_ALIGN);
  const L = e.len / e.count;
  const along = new Uint8Array(e.count);
  for (let i = 0; i < e.count; i++) {
    if (!pieceBuilt(codes[i])) continue;
    const s = (i + 0.5) * L;
    const mx = e.ax + e.ux * s;
    const mz = e.az + e.uz * s;
    const r = riverKeepOff() * (e.a.width + ((e.b.width - e.a.width) * s) / e.len) + fw;
    // An arterial only from inside the biome bearing it: one along its edge is the belt's to judge.
    const onStreets = bearsRoads(zoneAtWarped(mx, mz).biome.id);
    for (const p of paths) {
      if (!onStreets && (p.kind === "arterial" || p.kind === "arterialSeg")) continue;
      for (let k = 0; k + 1 < p.wx.length && !along[i]; k++) {
        const dx = p.wx[k + 1] - p.wx[k];
        const dz = p.wz[k + 1] - p.wz[k];
        if (distanceToSegment(mx, mz, p.wx[k], p.wz[k], p.wx[k + 1], p.wz[k + 1]) < r && Math.abs(dx * e.ux + dz * e.uz) > cos * Math.hypot(dx, dz)) along[i] = 1;
      }
      if (along[i]) break;
    }
  }
  for (const [i0, i1] of runsOf(along, (a) => a === 1)) if ((i1 - i0 + 1) * L >= RIVER_ROAD_ALONG_MIN) codes.fill(PIECE_ROAD, i0, i1 + 1);
};

/** The widths the layer measures footprints by: the gorged edge with its natural ends. */
const provisionalWidths = (e: RiverEdge, codes: Uint8Array): Float64Array =>
  stretchWidths(e, codes, (j) => (builtAt(e, j, climbedCodes) ? "none" : "natural"));

/** The edge's codes once the roads have their say (before ends retract), and the roads it read. */
export const roadCodes = (e: RiverEdge): Uint8Array => {
  if (e.roadCodes) return e.roadCodes;
  const codes = climbedCodes(e).slice();
  e.roads = null;
  e.triggers = [];
  if (riverEdgeNearRoads(e) && codes.some(pieceBuilt)) {
    const widths = provisionalWidths(e, codes);
    const pieces: RiverPiece[] = spansOf(e, codes, widths).map((p) => ({ sx: p.sx, sz: p.sz, ex: p.ex, ez: p.ez, w0: p.w0, w1: p.w1, edge: e, index: p.i }));
    const paths = roadPathsNear(e, pieces);
    e.roads = paths;
    alongRoads(e, codes, paths);
    let stretches: Stretch[] = [];
    // A removal can leave a road grazing the new end: up to one pass per piece.
    for (let pass = 0; pass < e.count; pass++) {
      const spans = spansOf(e, codes, provisionalWidths(e, codes));
      if (spans.length === 0) break;
      stretches = judgeStretches(e, spans, paths);
      let changed = false;
      const reach = riverKeepOff();
      for (const s of stretches) {
        if (s.verdict !== "fail") continue;
        const yieldAt = s.path.kind === "run" ? runRiverYield() : reach;
        for (let i = s.i0; i <= s.i1; i++) {
          if (!s.wet[i]) continue;
          for (const p of spans) {
            if (!pieceBuilt(codes[p.i])) continue;
            const t = Math.max(0, Math.min(1, ((s.path.wx[i] - p.sx) * e.ux + (s.path.wz[i] - p.sz) * e.uz) / (e.len / e.count)));
            const d = distanceToSegment(s.path.wx[i], s.path.wz[i], p.sx, p.sz, p.ex, p.ez);
            if (d < yieldAt * (p.w0 + (p.w1 - p.w0) * t) + deckWidth() / 2) {
              codes[p.i] = PIECE_ROAD;
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
    }
    // What an end may not stay under: a run; a belt, but not on a decked crossing nor where the
    // waterfront carries it along the river; an arterial crossing too shallow for a deck.
    const carried = Math.cos(RIVER_BELT_CARRIED);
    for (const path of paths) {
      const n = path.wx.length;
      for (let i = 0; i < n; i++) {
        const inStretch = stretches.find((s) => s.path === path && i >= s.i0 && i <= s.i1);
        if (path.kind === "belt") {
          const dx = path.wx[Math.min(n - 1, i + 1)] - path.wx[Math.max(0, i - 1)];
          const dz = path.wz[Math.min(n - 1, i + 1)] - path.wz[Math.max(0, i - 1)];
          if (inStretch?.verdict === "deck" || Math.abs(dx * e.ux + dz * e.uz) > carried * (Math.hypot(dx, dz) || 1)) continue;
        } else if (path.kind !== "run" && !inStretch?.shallow) continue;
        e.triggers.push(path.wx[i], path.wz[i]);
      }
    }
  }
  e.roadCodes = codes;
  return codes;
};

/** How edge e's river ends at junction j once every edge has had its road layer: it goes on (another
 *  river leaves), ends bluntly (every other river there gave way to a road) or ends naturally. */
export const junctionEndKind = (e: RiverEdge, j: RiverJunction): JunctionEnd =>
  builtAt(e, j, finalCodes) ? "none" : builtAt(e, j, climbedCodes) ? "blunt" : "natural";

/** The edge's final codes: its road layer, with every river end under a road retracted. */
export const finalCodes = (e: RiverEdge): Uint8Array => {
  if (e.codes) return e.codes;
  const codes = roadCodes(e).slice();
  const triggers = e.triggers ?? [];
  if (triggers.length > 0) {
    const kindAt = (j: RiverJunction): JunctionEnd => (builtAt(e, j, roadCodes) ? "none" : builtAt(e, j, climbedCodes) ? "blunt" : "natural");
    const reach = riverKeepOff();
    // The river's own footprint, its end shape left out: a road along a pond's bank does not eat it.
    const base = stretchWidths(e, new Uint8Array(e.count), () => "none");
    const underRoad = (i: number): boolean => {
      const span = spansOf(e, codes, base).find((p) => p.i === i)!;
      for (let k = 0; k < triggers.length; k += 2) if (measure(e, [span], triggers[k], triggers[k + 1]).dn < reach) return true;
      return false;
    };
    const ends: { i: number; dir: 1 | -1; limit: number }[] = [];
    for (let i0 = 0; i0 < e.count; ) {
      if (!pieceBuilt(codes[i0])) {
        i0++;
        continue;
      }
      let i1 = i0;
      while (i1 + 1 < e.count && pieceBuilt(codes[i1 + 1])) i1++;
      for (const [i, dir, j] of [
        [i0, 1, i0 === 0 ? e.a : null],
        [i1, -1, i1 === e.count - 1 ? e.b : null],
      ] as [number, 1 | -1, RiverJunction | null][]) {
        // A mouth (the river running on into deep water) is no end to retract.
        if (!j && codes[i - dir] === PIECE_WATER) continue;
        const kind = j ? kindAt(j) : "natural";
        if (kind !== "none") ends.push({ i, dir, limit: kind === "blunt" && j ? RIVER_JUNCTION_RETRACT : Infinity });
      }
      i0 = i1 + 1;
    }
    for (const end of ends) {
      for (let i = end.i, steps = 0; i >= 0 && i < e.count && steps < end.limit && pieceBuilt(codes[i]) && underRoad(i); i += end.dir, steps++) codes[i] = PIECE_ROAD;
    }
  }
  e.codes = codes;
  return codes;
};
