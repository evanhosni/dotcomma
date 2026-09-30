/** The census of freeway connections the water severs (tests and probes): every wet freeway stretch
 *  near a river that no deck carries across. */

import { CITY_BIOME_ID } from "../../../world/constants";
import { distanceToSegment } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { domainConfig } from "../computeConfig";
import { warp } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { type RiverEdge, riverEdgePiece, type RiverPiece, riverPiecesNear, riversEnabled, riverWetReach } from "../rivers/riverNetwork";
import { riverEdgeNearRoads } from "../rivers/riverRoadLayer";
import { zoneAtWarped } from "../voronoi";
import { BRIDGE_ROAD_MARGIN, BRIDGE_WET_MERGE, BRIDGE_WET_SAMPLE, DEFAULT_BRIDGE_PLACEMENT, runRiverYield, warpMax } from "./constants";
import { bridgeWithinEnds } from "./deckGeometry";
import { getFreewayBridgesNear } from "./freewayBridges";
import { pavedAt } from "./landings";
import { polylinesApart, projectOnPolyline } from "./polyline";
import { edgeRoadPaths, withoutCarriedStretches } from "./roadPaths";
import { bridgeRiverCrossing, centerlineCrossings } from "./rules";
import type { FreewayBridge, SeveredFreeway, WindowScan } from "./types";

/** A deck serves a dry road end when one of its ends lands within this, or its strip covers the road
 *  a little way on (SEVERED_SERVE_AHEAD). */
const SEVERED_SERVE_LAND = 45;
const SEVERED_SERVE_AHEAD = 12;
/** …or by pavement reaching a deck's landed end within this (a flood fill on a SEVERED_PAVED_STEP lattice). */
const SEVERED_PAVED_REACH = 320;
const SEVERED_PAVED_STEP = 4;
/** Where the waterfront takes a belt over, it runs within this of the belt's last sample (the widest
 *  footprint and a freeway's width). */
const SEVERED_WATERFRONT_SEED = 180;
/** A dry road end is searched from the pavement this close to it (its sample may sit on the curb). */
const SEVERED_END_SEED = 12;
/** A belt path's end this close inside the yield (factor-1 units) is the ring going on onto dry land. */
const SEVERED_RING_EDGE = 8;
/** What the last census justified rather than counted: city arterials the quay carries. */
export const severedDebug = { quay: 0 };

/** THE INVARIANT's census — a connecting freeway ALWAYS gets across a river: every freeway — inter-city run, belt, arterial — near every river reaching the box, cut into its
 *  WET stretches (the centerline inside the yield the terrain gives the road to the river: a run's
 *  near the water, blended to the belt's at a belt corner, the others' over the footprint). A belt
 *  the waterfront carries and a city arterial the quay carries (both along the river, on the bank)
 *  are not wet. A stretch is carried when a deck's drawn strip covers every wet sample of it, or
 *  when its dry end(s) are served by decks that cross the river and meet (one deck, a Y, a T) — or
 *  one end's deck lands on pavement the other end's road reaches:
 *   - a stretch from bank to bank ("cross") needs both ends so joined;
 *   - one that leaves on the bank it came from ("graze") has no deck (none may run along the shore):
 *     the road layer gives the river way, so any left is severed;
 *   - one where the road ends in the water at a junction ("open") needs its dry end served (a T
 *     into the deck carrying the road it joins);
 *  except a city arterial that does not cross the river (it follows the shore, grazes it, or ends in
 *  it on its own bank): the quay road along the bank meets it and carries it on (severedDebug.quay
 *  counts them; riverNetwork's road layer leaves the river there).
 *  Probes and tests. */
export const getSeveredFreeways = (minX: number, minZ: number, maxX: number, maxZ: number): SeveredFreeway[] => {
  severedDebug.quay = 0;
  if (!domainConfig || !riversEnabled) return [];
  const rv = domainConfig.river;
  const reach = rv.halfWidth + rv.bank;
  const a = warp(minX, minZ);
  const b = warp(maxX, maxZ);
  const pad = warpMax() + riverWetReach() + BRIDGE_ROAD_MARGIN;
  const edges = new Map<string, RiverEdge>();
  for (const p of riverPiecesNear(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), pad)) edges.set(p.edge.key, p.edge);
  const deckCell = new Map<string, FreewayBridge[]>();
  const decksAt = (x: number, z: number): FreewayBridge[] => {
    const ix = Math.floor(x / 256);
    const iz = Math.floor(z / 256);
    const key = `${ix},${iz}`;
    let list = deckCell.get(key);
    if (!list) deckCell.set(key, (list = getFreewayBridgesNear(ix * 256, iz * 256, (ix + 1) * 256, (iz + 1) * 256, DEFAULT_BRIDGE_PLACEMENT, 0)));
    return list;
  };
  const onDeck = (d: FreewayBridge, x: number, z: number): boolean => {
    const pr = projectOnPolyline(d.path.map((q) => q.x), d.path.map((q) => q.z), x, z);
    return pr.d <= d.width / 2 && bridgeWithinEnds(d, x, z, pr.s / d.length);
  };
  const carried = (x: number, z: number): boolean => decksAt(x, z).some((d) => onDeck(d, x, z));
  const crosses = new Map<FreewayBridge, boolean>();
  const deckCrosses = (d: FreewayBridge): boolean => {
    let c = crosses.get(d);
    if (c === undefined) crosses.set(d, (c = bridgeRiverCrossing(d).odd));
    return c;
  };
  const touching = (p: FreewayBridge, q: FreewayBridge): boolean => {
    if (p === q) return true;
    const r = (p.width + q.width) / 2 + 1;
    return polylinesApart(p.path, q.path) < r;
  };
  // The decks serving a dry road end at (x, z) heading (dx, dz) into the water.
  const servedBy = (x: number, z: number, dx: number, dz: number): FreewayBridge[] => {
    const out: FreewayBridge[] = [];
    const seen = new Set<FreewayBridge>();
    for (const ox of [-SEVERED_SERVE_LAND, SEVERED_SERVE_LAND]) {
      for (const oz of [-SEVERED_SERVE_LAND, SEVERED_SERVE_LAND]) {
        for (const d of decksAt(x + ox, z + oz)) {
          if (seen.has(d)) continue;
          seen.add(d);
          const s = d.path[0];
          const t = d.path[d.path.length - 1];
          if (Math.min(Math.hypot(s.x - x, s.z - z), Math.hypot(t.x - x, t.z - z)) < SEVERED_SERVE_LAND || onDeck(d, x + dx * SEVERED_SERVE_AHEAD, z + dz * SEVERED_SERVE_AHEAD)) out.push(d);
        }
      }
    }
    return out;
  };
  // A deck set crossing the river: a deck that crosses, or one touching a deck that does.
  const bridges = (set: FreewayBridge[]): FreewayBridge[] => {
    const out: FreewayBridge[] = [];
    for (const d of set) {
      if (deckCrosses(d)) out.push(d);
      else {
        for (const q of decksAt(d.x, d.z)) if (q !== d && deckCrosses(q) && touching(d, q)) out.push(q);
      }
    }
    return out;
  };
  // Whether pavement connects (x, z) to a landed end of one of the decks, within SEVERED_PAVED_REACH.
  // (From every paved cell within `seed` of it: a belt end where the waterfront takes over lies in
  // the water, the waterfront beside it on the bank.)
  const pavedTo = (x: number, z: number, decks: FreewayBridge[], seed = 0): boolean => {
    const ends: PointXZ[] = [];
    for (const d of decks) for (const q of [d.path[0], d.path[d.path.length - 1]]) if (Math.hypot(q.x - x, q.z - z) < SEVERED_PAVED_REACH) ends.push(q);
    return reaches(x, z, ends, seed);
  };
  // Whether road pavement — or a deck's drawn strip — connects (x, z) to any of `ends` within SEVERED_PAVED_REACH.
  const reaches = (x: number, z: number, ends: PointXZ[], seed = 0): boolean => {
    if (ends.length === 0) return false;
    // (Pavement as the decks' ends know it — a city sidewalk included: a cut end lands on it.)
    const passable = (px: number, pz: number) => pavedAt(px, pz) || carried(px, pz);
    const st = SEVERED_PAVED_STEP;
    const R = Math.ceil(SEVERED_PAVED_REACH / st);
    const seenCell = new Set<number>();
    const queue: [number, number][] = [];
    const S = Math.ceil(seed / st);
    for (let a = -S; a <= S; a++) {
      for (let b = -S; b <= S; b++) {
        if (a * a + b * b > S * S) continue;
        if ((a !== 0 || b !== 0) && !passable(x + a * st, z + b * st)) continue;
        seenCell.add((a + R) * (2 * R + 1) + (b + R));
        queue.push([a, b]);
      }
    }
    while (queue.length > 0) {
      const [i, j] = queue.shift()!;
      const px = x + i * st;
      const pz = z + j * st;
      if (ends.some((q) => Math.hypot(q.x - px, q.z - pz) < st * 2)) return true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (Math.abs(a) > R || Math.abs(b) > R) continue;
        const k = (a + R) * (2 * R + 1) + (b + R);
        if (seenCell.has(k)) continue;
        seenCell.add(k);
        if (passable(x + a * st, z + b * st)) queue.push([a, b]);
      }
    }
    return false;
  };
  const out: SeveredFreeway[] = [];
  const seen = new Set<string>();
  for (const key of [...edges.keys()].sort()) {
    const e = edges.get(key)!;
    if (!riverEdgeNearRoads(e)) continue;
    const pieces: RiverPiece[] = [];
    for (let i = 0; i < e.count; i++) {
      const p = riverEdgePiece(e, i);
      if (p) pieces.push(p);
    }
    if (pieces.length === 0) continue;
    const paths = withoutCarriedStretches(edgeRoadPaths(e, pieces));
    const beltSegs: number[] = [];
    for (const p of paths) if (p.kind === "belt") for (let k = 0; k + 1 < p.wx.length; k++) beltSegs.push(p.wx[k], p.wz[k], p.wx[k + 1], p.wz[k + 1]);
    for (const path of paths) {
      const n = path.wx.length;
      const wet: boolean[] = [];
      for (let i = 0; i < n; i++) {
        riverFieldAt(path.wx[i], path.wz[i]);
        let yieldAt = reach;
        if (path.kind === "run") {
          yieldAt = runRiverYield();
          for (let s = 0; s < beltSegs.length; s += 4) {
            if (distanceToSegment(path.wx[i], path.wz[i], beltSegs[s], beltSegs[s + 1], beltSegs[s + 2], beltSegs[s + 3]) < 16) {
              yieldAt = reach;
              break;
            }
          }
        }
        const w = riverSample.distance < yieldAt;
        wet.push(w);
      }
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]));
      for (let lo = 0; lo < n; ) {
        if (!wet[lo]) {
          lo++;
          continue;
        }
        let hi = lo;
        for (;;) {
          let next = hi + 1;
          while (next < n && !wet[next]) next++;
          if (next < n && cum[next] - cum[hi] <= BRIDGE_WET_MERGE + 1e-6) hi = next;
          else break;
        }
        const i0 = lo;
        lo = hi + 1;
        // (A belt is a ring: where its path stops at a sample only just inside the yield, the ring goes
        // on beyond on walls too far from the river to be taken — dry land.)
        const ringOn = (i: number) => {
          if (path.kind !== "belt" || path.carried?.[i === 0 ? 0 : 1]) return false;
          riverFieldAt(path.wx[i], path.wz[i]);
          return riverSample.distance > reach - SEVERED_RING_EDGE;
        };
        const open0 = i0 === 0 && !path.landed?.[0] && !ringOn(0);
        const open1 = hi === n - 1 && !path.landed?.[1] && !ringOn(n - 1);
        if (open0 && open1) continue;
        let length = 0;
        let mid = -1;
        for (let i = i0; i <= hi; i++) {
          if (!wet[i] || carried(path.x[i], path.z[i])) continue;
          length += BRIDGE_WET_SAMPLE;
          if (mid < 0) mid = i;
        }
        if (mid < 0) continue;
        const wx = path.wx.slice(Math.max(0, i0 - 1), Math.min(n, hi + 2));
        const wz = path.wz.slice(Math.max(0, i0 - 1), Math.min(n, hi + 2));
        // Across THIS river (a confluence's other edge judges its own stretch).
        const odd = centerlineCrossings({ pieces, built: pieces } as WindowScan, wx, wz).odd;
        // Each dry end: the sample before the stretch, heading into it.
        const endServed = (dry: number, into: number): FreewayBridge[] => {
          const l = Math.hypot(path.x[into] - path.x[dry], path.z[into] - path.z[dry]) || 1;
          return bridges(servedBy(path.x[dry], path.z[dry], (path.x[into] - path.x[dry]) / l, (path.z[into] - path.z[dry]) / l));
        };
        // A city arterial that does not cross the river — it follows the shore, grazes it or ends in it
        // on its own bank — meets the quay: the city's road along the bank carries it on.
        if ((path.kind === "arterial" || path.kind === "arterialSeg") && !odd) {
          severedDebug.quay++;
          continue;
        }
        let shape: SeveredFreeway["shape"];
        let severed: boolean;
        if (!open0 && !open1) {
          shape = odd ? "cross" : "graze";
          // A graze's two dry ends on one bank are joined when the road goes on round it (a deck landing
          // beside it, the next road): severed only where nothing connects them.
          if (!odd) severed = !reaches(path.x[Math.max(0, i0 - 1)], path.z[Math.max(0, i0 - 1)], [{ x: path.x[Math.min(n - 1, hi + 1)], z: path.z[Math.min(n - 1, hi + 1)] }], SEVERED_END_SEED);
          else {
            const d0 = i0 > 0 ? i0 - 1 : 0;
            const d1 = hi < n - 1 ? hi + 1 : n - 1;
            const s0 = endServed(d0, i0 > 0 ? i0 : Math.min(n - 1, 1));
            const s1 = endServed(d1, hi < n - 1 ? hi : Math.max(0, n - 2));
            // Joined by the decks, or by a deck serving one end that lands on pavement the other end's
            // road reaches (the belt meeting the waterfront a little way from where a deck lands on it).
            const seed0 = i0 === 0 ? SEVERED_WATERFRONT_SEED : 0;
            const seed1 = hi === n - 1 ? SEVERED_WATERFRONT_SEED : 0;
            severed = !s0.some((p) => s1.some((q) => touching(p, q))) && !pavedTo(path.x[d1], path.z[d1], s0, seed1) && !pavedTo(path.x[d0], path.z[d0], s1, seed0);
          }
        } else if ((open0 && path.carried?.[0]) || (open1 && path.carried?.[1])) {
          // It runs into the water where the city carries the road on along the bank (waterfront, quay).
          continue;
        } else {
          shape = "open";
          const dry = open0 ? (hi < n - 1 ? [hi + 1, hi] : [n - 1, Math.max(0, n - 2)]) : i0 > 0 ? [i0 - 1, i0] : [0, Math.min(n - 1, 1)];
          severed = endServed(dry[0], dry[1]).length === 0;
        }
        if (!severed) continue;
        const x = path.x[mid];
        const z = path.z[mid];
        const k = `${Math.round(x / 12)},${Math.round(z / 12)}`;
        if (seen.has(k) || x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
        seen.add(k);
        out.push({ x, z, kind: path.kind, length, shape, city: zoneAtWarped(path.wx[mid], path.wz[mid]).biome.id === CITY_BIOME_ID });
      }
    }
  }
  return out;
};
