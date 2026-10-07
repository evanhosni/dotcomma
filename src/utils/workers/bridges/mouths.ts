/** Step 6b: FREEWAY MOUTHS — where any freeway is last dry before a river's footprint — per river edge
 *  over the whole edge, so every window agrees: pairs facing each other across the river, branches
 *  onto a pair's deck, lone mouths' straight decks. */

import { distanceToSegment } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp, warp, warpMax } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { RIVER_MEANDER_AMP, riverWetReach } from "../rivers/constants";
import { riverEdgePiece, riverPiecesNear, riversEnabled } from "../rivers/riverNetwork";
import type { RiverEdge, RiverPiece } from "../rivers/types";
import { riverEdgeNearRoads } from "../rivers/riverRoadLayer";
import { freewayDistanceAt } from "../vertexCompute";
import { BRIDGE_MAX_DEVIATION, BRIDGE_RAMP_LENGTH, BRIDGE_RAMP_SHARE, BRIDGE_WET_MERGE, deckWidth, DEFAULT_BRIDGE_PLACEMENT, MOUTH_SAMPLE, runRiverYield, streetDeckWidth } from "./constants";
import { CROSSING_MAX_SKEW, failedCrossing, straightCrossing } from "./crossings";
import { whileEnumeratingBridges } from "./freewayBridges";
import { dropShortLegs, hermitePoints, polyDirAt, polyPointAt, projectOnPolyline, simplifyPolyline } from "./polyline";
import { edgeRoadPaths } from "./roadPaths";
import { builtCrossingRule, mouthCurveRules } from "./rules";
import type { CrossingGeom, Mouth, RoadPath } from "./types";

/** A mouth left over after the pairing, teeing into a pair's deck. */
interface MouthBranch {
  mouth: Mouth;
  trunk: MouthPair;
  geom: CrossingGeom;
}

interface MouthPair {
  mouths: [Mouth, Mouth];
  geom: CrossingGeom;
}

interface EdgeMouths {
  mouths: Mouth[];
  pairs: MouthPair[];
  branches: MouthBranch[];
  /** Every mouth with the mouths it faces across the river, best first: where no pair or branch
   *  serves it, it tees into the NATURAL deck of the first of them one lands at (a road's own deck is
   *  decided in the window, so this one is too — bridgesInWindow's resolveNatural). */
  naturals: { mouth: Mouth; faces: Mouth[] }[];
}

/** Two mouths at most this far apart are joined: a wide river crossed diagonally between two cities
 *  (at 300 every such case is left unconnected). */
export const MOUTH_PAIR_MAX = 700;
/** A curved deck leaves each road at most this far off the chord between the two mouths. */
const MOUTH_PAIR_TURN = (50 * Math.PI) / 180;
/** The chord between two joined mouths is at most this far off square to the river (the curve itself
 *  must still cross at ≥ BRIDGE_MIN_CROSSING). */
const MOUTH_PAIR_SKEW = (50 * Math.PI) / 180;
/** The Hermite's tangent length, × the chord. */
export const MOUTH_TANGENT = 0.6;

/** A branch meets its trunk at one of these angles, at stations this far apart along the trunk. */
const MOUTH_BRANCH_ANGLES = [40, 55, 70].map((a) => (a * Math.PI) / 180);
const MOUTH_BRANCH_STEP = 12;
/** Away from the junction a branch's slab keeps this clear of its trunk's. */
const MOUTH_BRANCH_CLEAR = 2;

const MOUTH_SINGLE_SKEW = (50 * Math.PI) / 180;
const MOUTH_SINGLE_LAND = 24;
const MOUTH_SINGLE_NUDGES = [0, 8, -8, 16, -16];

const riverMouths = new Map<string, EdgeMouths>();
export const clearMouthCaches = (): void => riverMouths.clear();

/** The river's unit direction in the world at a warped point of edge e (the warp turns it slightly). */
export const edgeDirWorld = (e: RiverEdge, wx: number, wz: number): PointXZ => {
  const s = Math.max(0, Math.min(e.len, (wx - e.ax) * e.ux + (wz - e.az) * e.uz));
  const a = unwarp(e.ax + e.ux * s, e.az + e.uz * s);
  const b = unwarp(e.ax + e.ux * (s + 10), e.az + e.uz * (s + 10));
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};

/** Which side of edge e's line a world point lies on (warped cross product). */
export const edgeSide = (e: RiverEdge, x: number, z: number): number => {
  const w = warp(x, z);
  return (w.x - e.ax) * e.uz - (w.z - e.az) * e.ux;
};

/** Every mouth along edge e, the pairs facing each other, and the branches onto them. */
export const mouthsOf = (e: RiverEdge): EdgeMouths => {
  const cached = riverMouths.get(e.key);
  if (cached) return cached;
  if (riverMouths.size > 2048) dropOldestHalf(riverMouths);
  const entry: EdgeMouths = { mouths: [], pairs: [], branches: [], naturals: [] };
  riverMouths.set(e.key, entry);
  if (!e.widths || !riverEdgeNearRoads(e)) return entry;
  // Heights at the mouths evaluate the terrain, which must not ask for decks (they read these mouths).
  whileEnumeratingBridges(() => findEdgeMouths(e, entry));
  return entry;
};

const findEdgeMouths = (e: RiverEdge, entry: EdgeMouths): void => {
  const pieces: RiverPiece[] = [];
  for (let i = 0; i < e.count; i++) {
    const p = riverEdgePiece(e, i);
    if (p) pieces.push(p);
  }
  if (pieces.length === 0) return;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const half = deckWidth() / 2;
  const abutment = DEFAULT_BRIDGE_PLACEMENT.abutment;
  const bx = e.ax + e.ux * e.len;
  const bz = e.az + e.uz * e.len;
  const wMax = pieces.reduce((m, p) => Math.max(m, p.w0, p.w1), 0);
  const nearEdge = reach * wMax + RIVER_MEANDER_AMP + half;
  const distance = (wx: number, wz: number): number => {
    riverFieldAt(wx, wz, false, false);
    return riverSample.distance;
  };
  const seen = new Set<string>();
  const paths = edgeRoadPaths(e, pieces);
  for (const path of paths) {
    const yieldAt = path.kind === "run" ? runRiverYield() : reach;
    const n = path.wx.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]));
    // Wet as findWetItems has it: the centerline or either edge of the deck it would carry.
    const wet = path.wx.map((wx, i) => {
      if (distance(wx, path.wz[i]) < yieldAt) return true;
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = path.x[b] - path.x[a];
      const dz = path.z[b] - path.z[a];
      const l = Math.hypot(dx, dz) || 1;
      for (const s of [1, -1]) {
        const w = warp(path.x[i] - (dz / l) * half * s, path.z[i] + (dx / l) * half * s);
        if (distance(w.x, w.z) < yieldAt) return true;
      }
      return false;
    });
    // `abutment` on past the dry sample i, away from the wet one: from those samples alone (a path's
    // arc length from its start depends on where a belt loop was opened).
    const beyond = (i: number, j: number): PointXZ => {
      const l = Math.hypot(path.x[j] - path.x[i], path.z[j] - path.z[i]);
      const t = l > 0 ? Math.min(1, abutment / l) : 0;
      return { x: path.x[i] + (path.x[j] - path.x[i]) * t, z: path.z[i] + (path.z[j] - path.z[i]) * t };
    };
    for (let a = 0; a < n; ) {
      if (!wet[a]) {
        a++;
        continue;
      }
      let b = a;
      for (;;) {
        let next = b + 1;
        while (next < n && !wet[next]) next++;
        if (next < n && cum[next] - cum[b] <= BRIDGE_WET_MERGE + 1e-6) b = next;
        else break;
      }
      // Wet from THIS river (a confluence's other edge has its own mouths), and whether it reaches
      // the channel (a road grazing a bank has no straight crossing to make on its own).
      let mine = false;
      let channel = false;
      for (let i = a; i <= b; i++) {
        if (distanceToSegment(path.wx[i], path.wz[i], e.ax, e.az, bx, bz) >= nearEdge) continue;
        mine = true;
        if (distance(path.wx[i], path.wz[i]) < rv.halfWidth) channel = true;
      }
      if (mine) {
        // (Where the waterfront takes the belt over, its first sample is the dry end.)
        const ends = [
          a > 0 ? [a - 1, a] : path.landed?.[0] ? [0, Math.min(n - 1, 1)] : [-1, 0],
          b < n - 1 ? [b + 1, b] : path.landed?.[1] ? [n - 1, Math.max(0, n - 2)] : [-1, 0],
        ];
        for (const [dry, into] of ends) {
          if (dry < 0 || dry >= n) continue;
          const p = beyond(dry, into < dry ? Math.min(n - 1, dry + 1) : Math.max(0, dry - 1));
          const dx = path.x[into] - p.x;
          const dz = path.z[into] - p.z;
          const l = Math.hypot(dx, dz);
          if (l < 1e-6) continue;
          const key = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const w = warp(p.x, p.z);
          const side = Math.sign((w.x - e.ax) * e.uz - (w.z - e.az) * e.ux) || 1;
          const rd = edgeDirWorld(e, w.x, w.z);
          let nx = -rd.z;
          let nz = rd.x;
          if (nx * dx + nz * dz < 0) {
            nx = -nx;
            nz = -nz;
          }
          entry.mouths.push({ key, kind: path.kind, x: p.x, z: p.z, dx: dx / l, dz: dz / l, side, nx, nz, channel, hit: null, hitDx: 0, hitDz: 0, edge: e });
        }
      }
      a = b + 1;
    }
  }
  strandedRunEnds(e, paths, entry, nearEdge);
  entry.mouths.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  // A lone mouth's straight line: its road turned toward square, to where it crosses the centerline.
  const cosSingle = Math.cos(MOUTH_SINGLE_SKEW);
  const cosSkew = Math.cos(CROSSING_MAX_SKEW);
  for (const m of entry.mouths) {
    if (!m.channel) continue;
    let dx = m.dx;
    let dz = m.dz;
    const along = dx * m.nx + dz * m.nz;
    if (along < cosSingle) continue;
    if (along < cosSkew) {
      const ang = (Math.sign(m.nx * dz - m.nz * dx) || 1) * CROSSING_MAX_SKEW;
      dx = m.nx * Math.cos(ang) - m.nz * Math.sin(ang);
      dz = m.nx * Math.sin(ang) + m.nz * Math.cos(ang);
    }
    m.hit = centerlineAhead(e, m.x, m.z, dx, dz);
    m.hitDx = dx;
    m.hitDz = dz;
  }
  // Pairs: across the river, each road turning at most MOUTH_PAIR_TURN onto the chord, the chord near
  // square to the river, the curve keeping every rule; the best (short and straight) first.
  const ms = entry.mouths;
  const cands: { a: Mouth; b: Mouth; score: number }[] = [];
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const score = mouthPairScore(ms[i], ms[j]);
      if (score < Infinity) cands.push({ a: ms[i], b: ms[j], score });
    }
  }
  cands.sort((p, q) => p.score - q.score || (p.a.key < q.a.key ? -1 : p.a.key > q.a.key ? 1 : p.b.key < q.b.key ? -1 : 1));
  const used = new Set<Mouth>();
  for (const c of cands) {
    if (used.has(c.a) || used.has(c.b)) continue;
    const geom = mouthPairGeom(c.a, c.b);
    if (!geom.ok) continue;
    used.add(c.a);
    used.add(c.b);
    entry.pairs.push({ mouths: [c.a, c.b], geom });
  }
  // Branches: a mouth left over tees into the deck of a pair whose mouth across the river it faces —
  // unless it is at the same road junction as a paired mouth (that deck serves it).
  const paired = new Set(used);
  for (const m of ms) {
    if (used.has(m) || clusterMate(m, paired)) continue;
    const options: { pair: MouthPair; v: Mouth; score: number }[] = [];
    for (const pair of entry.pairs) {
      const v = pair.mouths.find((q) => q.side !== m.side)!;
      const score = mouthPairScore(m, v);
      if (score < Infinity) options.push({ pair, v, score });
    }
    options.sort((p, q) => p.score - q.score);
    for (const o of options) {
      const geom = mouthBranchGeom(m, o.v, o.pair.geom);
      if (!geom.ok) continue;
      entry.branches.push({ mouth: m, trunk: o.pair, geom });
      break;
    }
  }
  // Every mouth may tee into a road's own deck across the river: its pair's or branch's trunk may
  // itself overlap that deck (the road it faces crosses there already) and drop.
  for (const m of ms) {
    const faces = ms.filter((q) => mouthPairScore(m, q) < Infinity).sort((p, q) => mouthPairScore(m, p) - mouthPairScore(m, q) || (p.key < q.key ? -1 : 1));
    if (faces.length > 0) entry.naturals.push({ mouth: m, faces });
  }
};

/** A run ending at a belt corner every belt from which enters the river within this is STRANDED. */
const STRANDED_REACH = 40;

/** An inter-city run whose end — the belt corner it joins its city's belt at — is STRANDED on the bank:
 *  every belt leaving the corner runs into the river within STRANDED_REACH, so no road goes on from it
 *  (e.g. its corner's two walls both in the water — one carried along the far bank by the waterfront,
 *  the other crossing at a wall junction in the channel, too kinked for a deck). Its end is a MOUTH heading on along the run: its deck lands on the
 *  road across (the waterfront belt, a freeway). */
const strandedRunEnds = (e: RiverEdge, paths: RoadPath[], entry: EdgeMouths, nearEdge: number): void => {
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const bx = e.ax + e.ux * e.len;
  const bz = e.az + e.uz * e.len;
  const wetAt = (wx: number, wz: number): boolean => {
    riverFieldAt(wx, wz, false, false);
    return riverSample.distance < reach;
  };
  // Every belt sample, warped, in path order (a belt split by the waterfront leaves its drowned stretch
  // out: from the corner that way the road is in the water too).
  const belts = paths.filter((p) => p.kind === "belt");
  for (const run of paths) {
    if (run.kind !== "run" || run.wx.length < 3) continue;
    const n = run.wx.length;
    for (const [end, prev] of [
      [0, 1],
      [n - 1, n - 2],
    ]) {
      const cx = run.wx[end];
      const cz = run.wz[end];
      if (distanceToSegment(cx, cz, e.ax, e.az, bx, bz) >= nearEdge + STRANDED_REACH) continue;
      if (wetAt(cx, cz)) continue;
      // The belt directions leaving the corner, and whether each reaches the water.
      let ways = 0;
      let wet = 0;
      for (const belt of belts) {
        const m = belt.wx.length;
        for (let k = 0; k < m; k++) {
          if (Math.hypot(belt.wx[k] - cx, belt.wz[k] - cz) > 1) continue;
          for (const dir of [1, -1]) {
            let j = k + dir;
            if (j < 0 || j >= m) {
              // The path stops at the corner: where the waterfront took the belt over, that way is water.
              if (belt.landed?.[dir === 1 ? 1 : 0]) {
                ways++;
                wet++;
              }
              continue;
            }
            ways++;
            let hit = false;
            for (; j >= 0 && j < m && Math.hypot(belt.wx[j] - cx, belt.wz[j] - cz) <= STRANDED_REACH && !hit; j += dir) hit = wetAt(belt.wx[j], belt.wz[j]);
            if (hit || ((j < 0 || j >= m) && belt.landed?.[dir === 1 ? 1 : 0])) wet++;
          }
        }
      }
      if (ways === 0 || wet < ways) continue;
      const dx = run.x[end] - run.x[prev];
      const dz = run.z[end] - run.z[prev];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const x = run.x[end];
      const z = run.z[end];
      const key = `${Math.round(x * 100)},${Math.round(z * 100)}`;
      if (entry.mouths.some((q) => q.key === key)) continue;
      const w = warp(x, z);
      const side = Math.sign((w.x - e.ax) * e.uz - (w.z - e.az) * e.ux) || 1;
      const rd = edgeDirWorld(e, w.x, w.z);
      let nx = -rd.z;
      let nz = rd.x;
      if (nx * dx + nz * dz < 0) {
        nx = -nx;
        nz = -nz;
      }
      entry.mouths.push({ key, kind: "run", x, z, dx: dx / l, dz: dz / l, side, nx, nz, channel: true, hit: null, hitDx: 0, hitDz: 0, edge: e });
    }
  }
};

/** Mouths this close on one bank are one road junction: a deck landing at one serves them all
 *  (two decks from one junction would read as twins side by side). */
export const MOUTH_CLUSTER = 45;

/** A mouth of `set` other than m at m's road junction, if any. */
const clusterMate = (m: Mouth, set: Iterable<Mouth>): Mouth | null => {
  for (const q of set) if (q !== m && q.side === m.side && Math.hypot(q.x - m.x, q.z - m.z) < MOUTH_CLUSTER) return q;
  return null;
};

/** How well two mouths face each other across the river (lower is better; Infinity = not at all):
 *  opposite banks, at most MOUTH_PAIR_MAX apart, each road at most MOUTH_PAIR_TURN off the chord, the
 *  chord at most MOUTH_PAIR_SKEW off square. */
const mouthPairScore = (A: Mouth, B: Mouth): number => {
  if (A.side === B.side) return Infinity;
  const vx = B.x - A.x;
  const vz = B.z - A.z;
  const L = Math.hypot(vx, vz);
  if (L > MOUTH_PAIR_MAX || L < 1) return Infinity;
  const ca = (A.dx * vx + A.dz * vz) / L;
  const cb = -(B.dx * vx + B.dz * vz) / L;
  const cosTurn = Math.cos(MOUTH_PAIR_TURN);
  if (ca < cosTurn || cb < cosTurn) return Infinity;
  const mw = warp((A.x + B.x) / 2, (A.z + B.z) / 2);
  const rd = edgeDirWorld(A.edge, mw.x, mw.z);
  if (Math.abs(vx * rd.x + vz * rd.z) / L > Math.sin(MOUTH_PAIR_SKEW)) return Infinity;
  return L * (3 - ca - cb);
};

/** Every freeway mouth in a world box, and whether it is paired or branches (probes, tests). */
export const getFreewayMouths = (minX: number, minZ: number, maxX: number, maxZ: number): (Mouth & { paired: boolean; branch: boolean })[] => {
  if (!domainConfig || !riversEnabled) return [];
  const a = warp(minX, minZ);
  const b = warp(maxX, maxZ);
  const pad = warpMax() + riverWetReach();
  const edges = new Map<string, RiverEdge>();
  for (const p of riverPiecesNear(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), pad)) edges.set(p.edge.key, p.edge);
  const out: (Mouth & { paired: boolean; branch: boolean })[] = [];
  for (const e of [...edges.keys()].sort()) {
    const { mouths, pairs, branches } = mouthsOf(edges.get(e)!);
    const paired = new Set(pairs.flatMap((p) => p.mouths));
    const branch = new Set(branches.map((q) => q.mouth));
    for (const m of mouths) if (m.x >= minX && m.x < maxX && m.z >= minZ && m.z < maxZ) out.push({ ...m, paired: paired.has(m), branch: branch.has(m) });
  }
  return out;
};

/** A lone mouth's straight STREET-width deck (mouthsOf found its line): landed on both banks, and on
 *  its own bank at the mouth itself. A freeway-width deck only where it lands on a freeway on both
 *  sides (a mouth facing a freeway mouth, or the waterfront belt across). */
export const mouthSingleGeom = (m: Mouth): CrossingGeom => {
  if (!m.hit) return failedCrossing("no centerline ahead");
  // The line mouthsOf found, then square to the river; each nudged a little along the river when
  // its far end misses the pavement (a quay junction's corner).
  let first: CrossingGeom | null = null;
  const lines = [
    { dx: m.hitDx, dz: m.hitDz, hit: m.hit },
    { dx: m.nx, dz: m.nz, hit: centerlineAhead(m.edge, m.x, m.z, m.nx, m.nz) },
  ];
  for (const line of lines) {
    if (!line.hit) continue;
    for (const off of MOUTH_SINGLE_NUDGES) {
      const px = line.hit.x - m.nz * off;
      const pz = line.hit.z + m.nx * off;
      // Freeway-wide where it lands on a freeway on the far bank too (a stranded run onto the city's
      // waterfront belt), else a street deck.
      let r = straightCrossing(px, pz, line.dx, line.dz, deckWidth(), false).geom;
      if (!r.ok || !r.path.every((q) => freewayDistanceAt(q.x, q.z) <= domainConfig!.cityConfig.freewayWidth)) r = straightCrossing(px, pz, line.dx, line.dz, streetDeckWidth(), true).geom;
      let g = r;
      if (r.ok) {
        const [a, b] = r.path;
        const rule = builtCrossingRule(r.path, m.edge, 1);
        if (Math.hypot(b.x - a.x, b.z - a.z) > MOUTH_PAIR_MAX) g = failedCrossing("too long");
        else if (Math.min(Math.hypot(a.x - m.x, a.z - m.z), Math.hypot(b.x - m.x, b.z - m.z)) > MOUTH_SINGLE_LAND) g = failedCrossing("misses the mouth");
        else if (rule) g = failedCrossing(rule);
      }
      if (g.ok) return g;
      first ??= g;
    }
  }
  return first ?? failedCrossing("no centerline ahead");
};

/** Where a straight line from a world point along (dx, dz) first crosses edge e's centerline, within MOUTH_PAIR_MAX. */
const centerlineAhead = (e: RiverEdge, x: number, z: number, dx: number, dz: number): PointXZ | null => {
  const s0 = Math.sign(edgeSide(e, x, z));
  let prev = 0;
  for (let s = MOUTH_SAMPLE; s <= MOUTH_PAIR_MAX; s += MOUTH_SAMPLE) {
    if (Math.sign(edgeSide(e, x + dx * s, z + dz * s)) === s0) {
      prev = s;
      continue;
    }
    let lo = prev;
    let hi = s;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(edgeSide(e, x + dx * mid, z + dz * mid)) === s0) lo = mid;
      else hi = mid;
    }
    return { x: x + dx * hi, z: z + dz * hi };
  }
  return null;
};

/** Two mouths' curved freeway deck: a cubic Hermite tangent to both roads, keeping mouthCurveRules
 *  in both directions (so each landed end starts over the water). Both ends are dry and on their
 *  roads by construction (mouthsOf). */
export const mouthPairGeom = (A: Mouth, B: Mouth): CrossingGeom => {
  const L = Math.hypot(B.x - A.x, B.z - A.z);
  const pts = hermitePoints(A, { x: A.dx, z: A.dz }, B, { x: -B.dx, z: -B.dz }, L * MOUTH_TANGENT);
  const r = mouthCurveRules(pts, A.edge, true, 1);
  if (r.why) return failedCrossing(r.why);
  const back = mouthCurveRules([...pts].reverse(), A.edge, true, 1);
  if (back.why) return failedCrossing(back.why);
  let path = dropShortLegs(simplifyPolyline(pts.map((p) => p.x), pts.map((p) => p.z), BRIDGE_MAX_DEVIATION).map((i) => pts[i]));
  let ys: [number, number] = [NaN, NaN];
  const n = path.length;
  if (path[0].x > path[n - 1].x || (path[0].x === path[n - 1].x && path[0].z > path[n - 1].z)) {
    path = [...path].reverse();
    ys = [ys[1], ys[0]];
  }
  return { ok: true, why: "", path, ys, x: r.x, z: r.z, width: deckWidth(), street: false };
};

/** A leftover mouth U's freeway deck teeing into the trunk deck of a pair whose mouth V it faces:
 *  a cubic Hermite from U along its road to a point J on the trunk, arriving at one of
 *  MOUTH_BRANCH_ANGLES to the trunk heading toward V — the two merge into a Y that lands on V. J lies past the ramp at V and, where it can, on V's side of the centerline, so the
 *  branch itself crosses the river; its slab stays clear of the trunk's away from the junction (no
 *  overlapping slabs, no walls inside the other deck — finishDeck opens the trunk's parapet over it). */
export const mouthBranchGeom = (U: Mouth, V: Mouth, trunk: CrossingGeom): CrossingGeom => {
  const W = deckWidth();
  const P = trunk.path;
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  const L = cum[cum.length - 1];
  const vAtStart = Math.hypot(P[0].x - V.x, P[0].z - V.z) < Math.hypot(P[P.length - 1].x - V.x, P[P.length - 1].z - V.z);
  const arc = (s: number) => (vAtStart ? s : L - s);
  const ramp = Math.min(BRIDGE_RAMP_LENGTH, BRIDGE_RAMP_SHARE * L);
  const vSide = Math.sign(edgeSide(U.edge, V.x, V.z));
  const cosTurn = Math.cos(MOUTH_PAIR_TURN);
  let best: { pts: PointXZ[]; cost: number; x: number; z: number } | null = null;
  let firstWhy = "";
  for (const phi of MOUTH_BRANCH_ANGLES) {
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    // The branch's footprint on the trunk reaches (W/2)(1/sin + cot) either way of J: past V's ramp.
    const sMin = ramp + (W / 2) * (1 + cos) / sin + 4;
    for (let s = sMin; s <= L - sMin; s += MOUTH_BRANCH_STEP) {
      const J = polyPointAt(P, cum, arc(s));
      const d = polyDirAt(P, cum, arc(s));
      const h = vAtStart ? { x: -d.x, z: -d.z } : d;
      const nl = { x: -h.z, z: h.x };
      const sigma = Math.sign((U.x - J.x) * nl.x + (U.z - J.z) * nl.z) || 1;
      const t = { x: cos * h.x - sigma * sin * nl.x, z: cos * h.z - sigma * sin * nl.z };
      const chord = Math.hypot(J.x - U.x, J.z - U.z);
      if (chord < 2 * W || chord > MOUTH_PAIR_MAX) continue;
      if ((U.dx * (J.x - U.x) + U.dz * (J.z - U.z)) / chord < cosTurn) continue;
      const pts = hermitePoints(U, { x: U.dx, z: U.dz }, J, t, chord * MOUTH_TANGENT);
      const crosses = Math.sign(edgeSide(U.edge, J.x, J.z)) === vSide ? 1 : 0;
      const r = mouthCurveRules(pts, U.edge, true, crosses);
      if (r.why) {
        firstWhy ||= r.why;
        continue;
      }
      // Clear of the trunk wherever the branch is not yet merging into it.
      let bcum = 0;
      let clear = true;
      const merge = (W + MOUTH_BRANCH_CLEAR) / sin + 2;
      for (let i = pts.length - 1; i > 0 && clear; i--) {
        bcum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        if (bcum < merge) continue;
        if (projectOnPolyline(P.map((q) => q.x), P.map((q) => q.z), pts[i - 1].x, pts[i - 1].z).d < W + MOUTH_BRANCH_CLEAR) clear = false;
      }
      if (!clear) {
        firstWhy ||= "beside its trunk";
        continue;
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const cost = len * (crosses ? 1 : 3);
      if (!best || cost < best.cost - 1e-9) best = { pts, cost, x: crosses ? r.x : J.x, z: crosses ? r.z : J.z };
    }
  }
  if (!best) return failedCrossing(firstWhy || "no junction on its trunk");
  const pts = best.pts;
  let path = dropShortLegs(simplifyPolyline(pts.map((p) => p.x), pts.map((p) => p.z), BRIDGE_MAX_DEVIATION).map((i) => pts[i]));
  let ys: [number, number] = [NaN, NaN];
  let teeEnd: 0 | 1 = 1;
  const n = path.length;
  if (path[0].x > path[n - 1].x || (path[0].x === path[n - 1].x && path[0].z > path[n - 1].z)) {
    path = [...path].reverse();
    ys = [ys[1], ys[0]];
    teeEnd = 0;
  }
  return { ok: true, why: "", path, ys, x: best.x, z: best.z, width: W, street: false, teeEnd };
};
