/**
 * THE ROAD LAYER over the river network: where a freeway meets a river no deck may carry, the road
 * wins — the river is not built there — so no freeway is cut by water. Lazy per piece (it needs the
 * freeway network and every road near the edge), cached on the edge; riverNetwork's
 * resolveRiverPiece applies it, and it only ever removes pieces.
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { distanceToSegment } from "../../math/_math";
import { runRiverYield } from "../bridges/constants";
import { edgeRoadPathsUnbuilt } from "../bridges/roadPaths";
import { deckPathTurn } from "../bridges/rules";
import type { RoadPath } from "../bridges/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { cityRowEdgeZ, citySegEdgeX, cityWiggleSlope, getCityDistrict, rowWiggle, segWiggle } from "../roads/cityTerrain";
import { FREEWAY_LINK_CELLS, networkOf } from "../roads/freewayNetwork";
import { biomeSiteAt, getBiomeContext, cityWallsOf } from "../voronoi";
import { RIVER_BLOCK_WATER, RIVER_MEANDER_AMP, riverCellEntry, riverDebug, type RiverEdge, riverEdgeBlocked, riverKeepOff, type RiverPiece } from "./riverNetwork";

/** The road layer (riverPieceSuppressed): where a road runs within ALIGN of the river's direction
 *  inside its footprint for ALONG_MIN or more — longer than a deck should be — the river is not
 *  built there and ends bluntly (full width) on either side. Crossings stay (decks): a
 *  crossing at θ is inside the footprint over only ~2R/sin θ, and the angle gate keeps a grid of
 *  separate crossings (the city's arterials) from reading as one long stretch. */
const RIVER_ROAD_ALIGN_COS = Math.cos((35 * Math.PI) / 180);
const RIVER_ROAD_ALONG_MIN = 500;

/** Whether any city cell lies within FREEWAY_LINK_CELLS of a biome cell — roads exist only near
 *  cities (freeways link cities at most that far apart). */
const cityNearCache = new Map<string, boolean>();
export const clearRiverRoadLayer = (): void => cityNearCache.clear();
const cityNearCell = (cx: number, cz: number): boolean => {
  const key = `${cx},${cz}`;
  let near = cityNearCache.get(key);
  if (near === undefined) {
    if (cityNearCache.size > 4096) dropOldestHalf(cityNearCache);
    near = false;
    const n = FREEWAY_LINK_CELLS;
    for (let ix = cx - n; ix <= cx + n && !near; ix++) {
      for (let iz = cz - n; iz <= cz + n && !near; iz++) {
        if (biomeSiteAt(ix, iz).zone.biome.id === CITY_BIOME_ID) near = true;
      }
    }
    cityNearCache.set(key, near);
  }
  return near;
};

export const riverEdgeNearRoads = (e: RiverEdge): boolean => {
  if (e.nearRoads < 0) {
    const gs = domainConfig!.gridSize;
    e.nearRoads = 0;
    for (let s = 0; s <= e.len && !e.nearRoads; s += gs) {
      if (cityNearCell(Math.floor((e.ax + e.ux * s) / gs), Math.floor((e.az + e.uz * s) / gs))) e.nearRoads = 1;
    }
  }
  return e.nearRoads === 1;
};

/** Whether a road (inter-city run, belt, or in-city arterial) runs ALONG piece i: its centerline
 *  within the footprint plus the road's half-width of the piece's midpoint, within ALIGN of the
 *  river's direction. */
const riverPieceAlongRoad = (e: RiverEdge, i: number): boolean => {
  if (e.along[i] >= 0) return e.along[i] === 1;
  const s = ((i + 0.5) / e.count) * e.len;
  const mx = e.ax + e.ux * s;
  const mz = e.az + e.uz * s;
  const reach = riverKeepOff() * (e.wA + (e.wB - e.wA) * (s / e.len)) + domainConfig!.cityConfig.freewayWidth;
  const aligned = (dx: number, dz: number) => Math.abs(dx * e.ux + dz * e.uz) > RIVER_ROAD_ALIGN_COS * Math.hypot(dx, dz);
  const ctx = getBiomeContext({ x: mx, z: mz });
  let along = false;
  for (const run of networkOf(ctx).freeways) {
    for (let k = 0; k + 3 < run.pts.length && !along; k += 2) {
      const [ax, az, bx, bz] = [run.pts[k], run.pts[k + 1], run.pts[k + 2], run.pts[k + 3]];
      if (distanceToSegment(mx, mz, ax, az, bx, bz) < reach && aligned(bx - ax, bz - az)) along = true;
    }
    if (along) break;
  }
  if (!along) along = cityWallsOf(ctx).some((w) => distanceToSegment(mx, mz, w.sx, w.sz, w.ex, w.ez) < reach && aligned(w.ex - w.sx, w.ez - w.sz));
  if (!along && ctx.zone.biome.id === CITY_BIOME_ID) {
    // Arterials are world-space curves (axis distance, like cityArterialDist); compare in world space.
    const p = unwarp(mx, mz);
    const q = unwarp(mx + e.ux * 10, mz + e.uz * 10);
    const worldAligned = (dx: number, dz: number) => Math.abs(dx * (q.x - p.x) + dz * (q.z - p.z)) > RIVER_ROAD_ALIGN_COS * Math.hypot(dx, dz) * Math.hypot(q.x - p.x, q.z - p.z);
    const d = getCityDistrict(p.x, p.z);
    for (const k of [d.r, d.r + 1]) {
      if (Math.abs(p.z - cityRowEdgeZ(k, p.x)) < reach && worldAligned(1, cityWiggleSlope(rowWiggle(k), p.x))) along = true;
    }
    for (const m of [d.m, d.m + 1]) {
      if (Math.abs(p.x - citySegEdgeX(d.r, m, p.z)) < reach && worldAligned(cityWiggleSlope(segWiggle(d.r, m), p.z), 1)) along = true;
    }
  }
  e.along[i] = along ? 1 : 0;
  return along;
};

/** Piece i lies in an along-road stretch of RIVER_ROAD_ALONG_MIN or more: the road wins there. */
const riverPieceAlongStretch = (e: RiverEdge, i: number): boolean => {
  if (e.suppressed[i] >= 0) return e.suppressed[i] === 1;
  const blocked = riverEdgeBlocked(e);
  const alongAt = (k: number) => k >= 0 && k < e.count && !blocked[k] && riverEdgeNearRoads(e) && riverPieceAlongRoad(e, k);
  if (!alongAt(i)) {
    e.suppressed[i] = 0;
    return false;
  }
  let lo = i;
  let hi = i;
  while (alongAt(lo - 1)) lo--;
  while (alongAt(hi + 1)) hi++;
  const suppressed = ((hi - lo + 1) / e.count) * e.len >= RIVER_ROAD_ALONG_MIN ? 1 : 0;
  for (let k = lo; k <= hi; k++) e.suppressed[k] = suppressed;
  return suppressed === 1;
};

/** The bridges' rules a wet road stretch must keep to be decked (bridges/rules.ts): it crosses at no
 *  shallower than this, follows the shore inside the footprint for no longer than MAX_ALONG (within
 *  ALONG_COS of the river), and turns no more than MAX_TURN (after the bridges round its corners). */
const RIVER_ROAD_MIN_CROSSING = (40 * Math.PI) / 180;
const RIVER_ROAD_MAX_ALONG = 60;
const RIVER_ROAD_ALONG_COS = Math.cos((35 * Math.PI) / 180);
const RIVER_ROAD_MAX_TURN = (45 * Math.PI) / 180;
/** A belt running within this of the river's direction is carried along the water by the city's
 *  waterfront (cityTerrain: its drowned measure passes half at ~41°), not cut. */
const RIVER_ROAD_WATERFRONT_COS = Math.cos((40 * Math.PI) / 180);
/** A road ending in the water tees into a deckable stretch of the road it joins within this (warped). */
const RIVER_ROAD_JUNCTION_NEAR = 24;
/** An undeckable stretch this close to a deckable one (warped) is carried by that one's deck. */
const RIVER_ROAD_DECK_NEAR = 20;
/** An end the road layers of the other rivers at a junction leave retracts this many pieces at most. */
const RIVER_JUNCTION_RETRACT = 2;
/** Wet stretches of one road this close merge (as the bridges' BRIDGE_WET_MERGE). */
const RIVER_ROAD_WET_MERGE = 16;

/** What the road layer knows of one edge while it decides it: the edge's own pieces (by `blocked`),
 *  the roads near them, each road sample's yield. `out` is the verdict being built. */
interface RoadLayerScan {
  e: RiverEdge;
  n: number;
  step: number;
  blocked: Uint8Array;
  widths: Float64Array;
  out: Uint8Array;
  reach: number;
  paths: RoadPath[];
  yields: number[][];
}

/** A wet stretch of a road path (samples lo..b) and how it meets this edge. */
interface RoadStretch {
  pi: number;
  lo: number;
  b: number;
  wet: boolean[];
  crossings: number;
  angle: number;
  along: number;
  cls: "graze" | "shallow" | "along" | "openAlong" | "stranded";
}

const builtIn = (s: RoadLayerScan, i: number): boolean => i >= 0 && i < s.n && !s.blocked[i] && !s.out[i];

/** Piece i's distance to a warped point in factor-1 units, the meander taken off (a margin over the
 *  per-vertex field) — or added (`margin`), for what is in the water for certain. */
const layerPieceDistance = (s: RoadLayerScan, i: number, wx: number, wz: number, margin = -RIVER_MEANDER_AMP - 2): number => {
  const { e, step, widths } = s;
  const sx = e.ax + e.ux * i * step;
  const sz = e.az + e.uz * i * step;
  let t = (wx - sx) * e.ux + (wz - sz) * e.uz;
  t = t < 0 ? 0 : t > step ? step : t;
  const w = widths[i] + (widths[i + 1] - widths[i]) * (t / step);
  return (Math.hypot(wx - sx - e.ux * t, wz - sz - e.uz * t) + margin) / Math.max(w, 1e-3);
};

const layerNearest = (s: RoadLayerScan, wx: number, wz: number, margin?: number): number => {
  let d = Infinity;
  for (let i = 0; i < s.n; i++) if (builtIn(s, i)) d = Math.min(d, layerPieceDistance(s, i, wx, wz, margin));
  return d;
};

/** A belt sample running along the river is carried by the waterfront (cityTerrain's wallDrownedAt is
 *  past half there), a city arterial's by the quay: road, not water (bridges/roadPaths'
 *  withoutCarriedStretches has the same). */
const layerCarried = (s: RoadLayerScan, p: RoadPath, k: number): boolean => {
  if (p.kind === "run") return false;
  const j = Math.min(p.wx.length - 1, k + 1);
  const h = Math.max(0, k - 1);
  const dx = p.wx[j] - p.wx[h];
  const dz = p.wz[j] - p.wz[h];
  return Math.abs(dx * s.e.ux + dz * s.e.uz) > (p.kind === "belt" ? RIVER_ROAD_WATERFRONT_COS : RIVER_ROAD_ALONG_COS) * Math.hypot(dx, dz);
};

/** How a stretch's polyline (samples lo-1..b+1) meets the edge: crossings of its built centerline —
 *  each END of a built stretch extended by its half-width (a pond's round end, as the bridges count
 *  them; not at a junction the river goes on through, where the extension would run into the other
 *  river's water and count a run beside a confluence twice), once per point (a path through a network
 *  hub passes one point twice) — the shallowest of them, and its length along the shore inside the
 *  footprint. */
const layerCrossings = (s: RoadLayerScan, p: RoadPath, lo: number, b: number): { crossings: number; angle: number; along: number } => {
  const { e, n, step, widths, reach } = s;
  const hw = domainConfig!.river.halfWidth;
  const m = p.wx.length;
  let crossings = 0;
  let angle = Math.PI / 2;
  let along = 0;
  const crossed: number[] = [];
  for (let k = Math.max(0, lo - 1); k <= b && k + 1 < m; k++) {
    const dx = p.wx[k + 1] - p.wx[k];
    const dz = p.wz[k + 1] - p.wz[k];
    const l = Math.hypot(dx, dz);
    if (l < 1e-9) continue;
    const cosRiver = Math.abs(dx * e.ux + dz * e.uz) / l;
    for (let i = 0; i < n; i++) {
      if (!builtIn(s, i)) continue;
      const s0 = i * step - ((i === 0 ? e.endA : !builtIn(s, i - 1)) ? hw * widths[i] : 0);
      const s1 = (i + 1) * step + ((i === n - 1 ? e.endB : !builtIn(s, i + 1)) ? hw * widths[i + 1] : 0);
      const ex0 = e.ax + e.ux * s0;
      const ez0 = e.az + e.uz * s0;
      const rx = e.ux * (s1 - s0);
      const rz = e.uz * (s1 - s0);
      const den = dx * rz - dz * rx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ex0 - p.wx[k]) * rz - (ez0 - p.wz[k]) * rx) / den;
      const u = ((ex0 - p.wx[k]) * dz - (ez0 - p.wz[k]) * dx) / den;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      const cx = p.wx[k] + dx * t;
      const cz = p.wz[k] + dz * t;
      let again = false;
      for (let c = 0; c < crossed.length && !again; c += 2) again = Math.hypot(crossed[c] - cx, crossed[c + 1] - cz) < 2;
      if (again) continue;
      crossed.push(cx, cz);
      crossings++;
      angle = Math.min(angle, Math.acos(Math.min(1, cosRiver)));
    }
    if (k < lo || k >= b) continue;
    if (cosRiver > RIVER_ROAD_ALONG_COS && layerNearest(s, (p.wx[k] + p.wx[k + 1]) / 2, (p.wz[k] + p.wz[k + 1]) / 2) < reach) {
      along += Math.hypot(p.x[k + 1] - p.x[k], p.z[k + 1] - p.z[k]);
    }
  }
  return { crossings, angle, along };
};

/** One pass over every road's wet stretches: which a deck may carry (their samples `deckable`), which
 *  not (`undeckable`), and which samples a river END may not lie under (`endless`: every run's — the
 *  only road between two cities —, a belt's except where it crosses deckably — its deck carries it
 *  over a river end too, e.g. a Y at two rivers' ends in a belt junction —, a city arterial's only
 *  where it crosses too shallow for a deck; elsewhere the quay or a deck carries it). */
const classifyRoadStretches = (s: RoadLayerScan): { deckable: number[]; undeckable: RoadStretch[]; endless: Uint8Array[] } => {
  const { paths, yields } = s;
  const deckable: number[] = [];
  const undeckable: RoadStretch[] = [];
  const openEnds: (RoadStretch & { k: number })[] = [];
  const endless = paths.map((p) => new Uint8Array(p.wx.length).fill(p.kind === "belt" || p.kind === "run" ? 1 : 0));
  const carry = (p: RoadPath, pi: number, lo: number, b: number, wet: boolean[], host: boolean) => {
    for (let k = lo; k <= b; k++) {
      if (wet[k] && host) deckable.push(p.wx[k], p.wz[k]);
      if (p.kind !== "run") endless[pi][k] = 0;
    }
  };
  paths.forEach((p, pi) => {
    const m = p.wx.length;
    const wet = p.wx.map((wx, k) => layerNearest(s, wx, p.wz[k]) < yields[pi][k] && !layerCarried(s, p, k));
    const cum = [0];
    for (let k = 1; k < m; k++) cum.push(cum[k - 1] + Math.hypot(p.x[k] - p.x[k - 1], p.z[k] - p.z[k - 1]));
    // (A road ends in the water only where its end sample is in it for certain — the meander on the
    // far side — or a run's end at a belt corner on the bank would read as in the river.)
    const certainlyWet = (k: number) => layerNearest(s, p.wx[k], p.wz[k], RIVER_MEANDER_AMP) < yields[pi][k];
    for (let a = 0; a < m; ) {
      if (!wet[a]) {
        a++;
        continue;
      }
      let b = a;
      for (;;) {
        let next = b + 1;
        while (next < m && !wet[next]) next++;
        if (next < m && cum[next] - cum[b] <= RIVER_ROAD_WET_MERGE + 1e-6) b = next;
        else break;
      }
      const lo = a;
      a = b + 1;
      const open = (lo === 0 && certainlyWet(0)) || (b === m - 1 && certainlyWet(m - 1));
      const { crossings, angle, along } = layerCrossings(s, p, lo, b);
      const odd = crossings % 2 === 1;
      // (A run may follow the shore on a deck that crosses — it is the only road between two cities —
      // but not into the water without crossing: there is nothing to tee into.)
      const alongOk = along <= RIVER_ROAD_MAX_ALONG || (p.kind === "run" && odd);
      const stretch = { pi, lo, b, wet, crossings, angle, along };
      const arterial = p.kind === "arterial" || p.kind === "arterialSeg";
      if (open && alongOk && !arterial) {
        // A belt or a run ending in the water tees into the road it joins there — if that road's own
        // stretch is decked (judged below, once every stretch is classified).
        openEnds.push({ ...stretch, cls: "stranded", k: lo === 0 ? 0 : m - 1 });
        continue;
      }
      if (open ? alongOk : odd && angle >= RIVER_ROAD_MIN_CROSSING && alongOk) {
        // A crossing too sharp for a deck even rounded is carried on a curve (the bridges'
        // smoothKink), which a road ending in the water beside it cannot tee into.
        const s0 = Math.max(0, lo - 1);
        const s1 = Math.min(m, b + 2);
        carry(p, pi, lo, b, wet, open || arterial || deckPathTurn(p.x.slice(s0, s1), p.z.slice(s0, s1)) <= RIVER_ROAD_MAX_TURN);
        continue;
      }
      const cls = open ? "openAlong" : !odd ? "graze" : angle < RIVER_ROAD_MIN_CROSSING ? "shallow" : "along";
      // A city arterial that does not cross the river deckably — it follows it, grazes it, or ends in it
      // on its own bank — is carried along the bank by the QUAY road (the city's own, getCityTerrain),
      // which it meets at both ends: removing the river under every one would take out a city's whole
      // river front.
      if (cls !== "shallow" && arterial) continue;
      for (let k = lo; k <= b; k++) endless[pi][k] = 1;
      undeckable.push({ ...stretch, cls });
    }
  });
  for (const o of openEnds) {
    const p = paths[o.pi];
    const x = p.wx[o.k];
    const z = p.wz[o.k];
    let host = false;
    for (let q = 0; q < deckable.length && !host; q += 2) host = Math.hypot(deckable[q] - x, deckable[q + 1] - z) < RIVER_ROAD_JUNCTION_NEAR;
    // …or the road it runs on into at the node (a run at a belt corner in the channel, the belt going on
    // to the far bank): the two together cross the river as one deck (the bridges' end-to-end chain).
    for (let j = 0; j < undeckable.length && !host; j++) {
      const u = undeckable[j];
      if (u.pi === o.pi || (u.cls !== "graze" && u.cls !== "openAlong")) continue;
      const q = paths[u.pi];
      let meets = false;
      for (let k = u.lo; k <= u.b && !meets; k++) meets = Math.hypot(q.wx[k] - x, q.wz[k] - z) < RIVER_ROAD_JUNCTION_NEAR;
      if (!meets || (o.crossings + u.crossings) % 2 === 0 || Math.min(o.angle, u.angle) < RIVER_ROAD_MIN_CROSSING || o.along + u.along > RIVER_ROAD_MAX_ALONG) continue;
      host = true;
      undeckable.splice(j, 1);
      carry(q, u.pi, u.lo, u.b, u.wet, true);
    }
    if (host) carry(p, o.pi, o.lo, o.b, o.wet, true);
    else undeckable.push(o);
  }
  return { deckable, undeckable, endless };
};

/** THE ROAD LAYER — a connecting freeway ALWAYS gets across (a deck, or the river gives way): per edge,
 *  from the freeways near it (edgeRoadPaths: runs, belts, arterials), the pieces the road wins, so no
 *  freeway is cut by water a deck cannot carry:
 *   - ALONG: an along-road stretch of RIVER_ROAD_ALONG_MIN or more (riverPieceAlongStretch);
 *   - UNDECKABLE: the pieces under a wet stretch that no deck may carry — a crossing shallower than
 *     RIVER_ROAD_MIN_CROSSING, a belt crossing that follows the shore longer than RIVER_ROAD_MAX_ALONG,
 *     a belt or run ending in the water with no deck to tee into there (STRANDED) — again and again,
 *     until none is left (a removal can leave a road grazing the new end). Not a GRAZE (a deck landing
 *     beside it or the road going on round it carries the connection — removing the river under every
 *     graze would take out whole river mouths between two cities, their decks with them), not a
 *     stretch beside one a deck carries, not a belt the waterfront or a city arterial the quay carries
 *     along the bank;
 *   - NO RIVER END UNDER A ROAD: a river END — natural (pond, fizzle), at an unbuilt piece, at a gap
 *     the road won, or at a junction every other river leaving gave up (RIVER_JUNCTION_RETRACT pieces
 *     at most: a longer retraction eats a decked crossing beside it) — retracts, piece by piece, while
 *     a road's centerline (`endless` samples) lies inside the end piece's footprint (no pond between
 *     two freeway stubs, no deck grazing a river's end). The new end is blunt, not a fizzle.
 *  Wetness is judged on the edge's own pieces by the straight centerline distance less the meander (a
 *  margin over the per-vertex field): a pure function of the edge and its roads, and of the junction's
 *  other edges' layers before their retraction (`beforeRetraction`). */
const riverEdgeRoadLayer = (e: RiverEdge, beforeRetraction = false): Uint8Array => {
  if (beforeRetraction && e.roadUnretracted) return e.roadUnretracted;
  if (!beforeRetraction && e.roadLayer) return e.roadLayer;
  const n = e.count;
  const out = new Uint8Array(n);
  const blocked = riverEdgeBlocked(e);
  const widths = e.widths;
  const done = (): Uint8Array => {
    e.roadUnretracted = out;
    e.roadLayer = out;
    return out;
  };
  if (!widths || !riverEdgeNearRoads(e)) return done();
  for (let i = 0; i < n; i++) {
    if (!blocked[i] && riverPieceAlongStretch(e, i)) {
      out[i] = 1;
      riverDebug.along++;
    }
  }
  const step = e.len / n;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const pieces: RiverPiece[] = [];
  for (let i = 0; i < n; i++) {
    if (blocked[i]) continue;
    const sx = e.ax + e.ux * i * step;
    const sz = e.az + e.uz * i * step;
    pieces.push({ sx, sz, ex: sx + e.ux * step, ez: sz + e.uz * step, w0: widths[i], w1: widths[i + 1], edge: e, index: i, resolved: true, suppressed: false });
  }
  if (pieces.length === 0) return done();
  const paths = edgeRoadPathsUnbuilt(e, pieces);
  if (paths.length === 0) return done();
  const runYield = runRiverYield();
  const s: RoadLayerScan = { e, n, step, blocked, widths, out, reach, paths, yields: paths.map((p) => p.wx.map(() => (p.kind === "run" ? runYield : reach))) };
  // A closed road (two runs between the same hubs, a whole belt ring) is opened at a dry sample: its
  // seam is no road end (a wet stretch across it would read as the road ending in the water).
  for (const p of paths) {
    const m = p.wx.length;
    if (m < 3 || Math.hypot(p.wx[0] - p.wx[m - 1], p.wz[0] - p.wz[m - 1]) > 1e-6) continue;
    let k = 0;
    while (k < m - 1 && pieces.some((q) => layerPieceDistance(s, q.index, p.wx[k], p.wz[k]) < reach)) k++;
    if (k === 0 || k >= m - 1) continue;
    for (const key of ["wx", "wz", "x", "z"] as const) p[key] = [...p[key].slice(k, m - 1), ...p[key].slice(0, k + 1)];
  }
  let endless: Uint8Array[] = [];
  for (let pass = 0; pass < n; pass++) {
    const verdict = classifyRoadStretches(s);
    endless = verdict.endless;
    let removed = false;
    for (const u of verdict.undeckable) {
      if (u.cls === "graze") continue;
      const p = paths[u.pi];
      let nearDeck = false;
      for (let k = u.lo; k <= u.b && !nearDeck; k++) {
        if (!u.wet[k]) continue;
        for (let q = 0; q < verdict.deckable.length && !nearDeck; q += 2) nearDeck = Math.hypot(verdict.deckable[q] - p.wx[k], verdict.deckable[q + 1] - p.wz[k]) < RIVER_ROAD_DECK_NEAR;
      }
      if (nearDeck) continue;
      for (let k = u.lo; k <= u.b; k++) {
        if (!u.wet[k]) continue;
        for (let i = 0; i < n; i++) {
          if (!builtIn(s, i) || !(layerPieceDistance(s, i, p.wx[k], p.wz[k]) < s.yields[u.pi][k])) continue;
          out[i] = 1;
          removed = true;
          riverDebug.undeckable++;
        }
      }
    }
    if (!removed) break;
  }
  e.roadUnretracted = out.slice();
  if (beforeRetraction) return e.roadUnretracted;
  retractRiverEnds(s, endless);
  e.roadLayer = out;
  return out;
};

/** The retraction (riverEdgeRoadLayer's NO RIVER END UNDER A ROAD). */
const retractRiverEnds = (s: RoadLayerScan, endless: Uint8Array[]): void => {
  const { e, n, blocked, out, paths, yields } = s;
  const underRoad = (i: number): boolean => {
    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      for (let k = 0; k < p.wx.length; k++) {
        if (endless[pi][k] && !layerCarried(s, p, k) && layerPieceDistance(s, i, p.wx[k], p.wz[k]) < yields[pi][k]) return true;
      }
    }
    return false;
  };
  const endsAtJunction = (junction: string, jx: number, jz: number): boolean =>
    !junctionRivers(e, junction, jx, jz).some((o) => {
      const at = o.keyA === junction ? 0 : o.count - 1;
      return !riverEdgeBlocked(o)[at] && !riverEdgeRoadLayer(o, true)[at];
    });
  // Past the pieces removed, the river ends at unbuilt land, at the edge's natural end, at a junction
  // no other river goes on from, or at a gap the road won; it goes on into water (a mouth).
  const endsBeyond = (i: number, dir: 1 | -1): boolean => {
    let k = i + dir;
    while (k >= 0 && k < n && !blocked[k] && out[k]) k += dir;
    if (k < 0) return k !== i + dir || e.endA || (i < RIVER_JUNCTION_RETRACT && endsAtJunction(e.keyA, e.ax, e.az));
    if (k >= n) return k !== i + dir || e.endB || (i >= n - RIVER_JUNCTION_RETRACT && endsAtJunction(e.keyB, e.ax + e.ux * e.len, e.az + e.uz * e.len));
    return k !== i + dir || (blocked[k] !== 0 && blocked[k] !== RIVER_BLOCK_WATER);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (!builtIn(s, i) || !(endsBeyond(i, -1) || endsBeyond(i, 1)) || !underRoad(i)) continue;
      out[i] = 1;
      riverDebug.retracted++;
      changed = true;
    }
  }
};

/** The OTHER rivers at a junction (its three sites make three edges; any that carries a river and has a
 *  built piece is in the entry of the river cell holding the junction, which triangulates it deep
 *  inside its window). */
const junctionRivers = (e: RiverEdge, junction: string, jx: number, jz: number): RiverEdge[] => {
  const sites = junction.split("/");
  const keys = new Set<string>();
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) keys.add(sites[a] < sites[b] ? `${sites[a]}~${sites[b]}` : `${sites[b]}~${sites[a]}`);
  }
  keys.delete(e.key);
  const out: RiverEdge[] = [];
  for (const o of riverCellEntry({ x: jx, z: jz }).edges) if (keys.has(o.key) && !out.includes(o)) out.push(o);
  return out;
};

/** Whether the road layer removes piece i (riverEdgeRoadLayer). */
export const riverPieceSuppressed = (e: RiverEdge, i: number): boolean => riverEdgeRoadLayer(e)[i] === 1;
