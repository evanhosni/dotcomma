import type { PointXZ } from "../../../../utils/math/types";
import { computeVertexData } from "../../..";
import { crossingGeom } from "../../crossings";
import { bridgeParapetLine, bridgeSections, bridgeTrimRange, crotchFlares, pathDistance, bridgeParapetAt } from "../geometry";
import { drawnOn, bridgeDrawnTopAt } from "../drawn-slab";
import { pavedAt } from "../utils";
import { mergeIntervals } from "../../utils";
import type { BridgeChain, BridgeParapetGap, FreewayBridge, BridgeSection, BridgeWallJoin } from "../../types";
import { teeHostChain } from "../../chains";
import { distanceToSegment } from "../../../../utils/math";
import { BRIDGE_PARAPET_WIDTH } from "../../constants";

/** Step 5: an owned deck's parapet gaps and lane paint, against every deck it meets. */

/** A landed end's parapet lines are tested for pavement this often (finishDeck). */
const BRIDGE_PAVED_WALL_STEP = 2;
/** …and against every deck it merges with this often (finishDeck), this far outside its drawn edge. */
const BRIDGE_COVERED_WALL_STEP = 0.5;
const BRIDGE_WALL_OUTSIDE = 0.05;
/** A wall left standing shorter than this between two openings, or an opening and the deck's end, opens. */
const BRIDGE_MIN_WALL_RUN = 6;

/** Lane paint is blanked this far past another deck's edge (the terrain's junction zones do the same). */
const BRIDGE_PAINT_JUNCTION_CLEAR = 8;
/** At a landed end whose road carries no lane paint, the deck's paint starts this far in. */
const BRIDGE_PAINT_END_CLEAR = 12;

/** The decks each finished deck merges with (its hosts, T-children and overlapping decks). Finishing
 *  twice would be wrong: the gaps are stations, so a second pass would see different sections. */
const mergedWith = new WeakMap<FreewayBridge, FreewayBridge[]>();
export const deckMerges = (deck: FreewayBridge): FreewayBridge[] | undefined => mergedWith.get(deck);

/** An owned deck's parapet gaps and lane paint, against every deck it meets — its hosts, its
 *  T-children, and any deck overlapping it: its walls stand only on the outer edge of their merged
 *  slabs, never over pavement, and never as a stub. Once per deck. */
export const finishDeck = (c: BridgeChain, chains: BridgeChain[], build: (c: BridgeChain) => FreewayBridge | null): void => {
  const deck = c.deck!;
  if (mergedWith.has(deck)) return;
  const others = new Set<FreewayBridge>();
  // A host's slab edge is where this deck's cut — and so its walls — already end: no gap against it.
  const hosts = new Set<FreewayBridge>();
  for (const e of c.ends) {
    const h = teeHostChain(e)?.deck;
    if (h) hosts.add(h);
  }
  for (const child of c.children) {
    const d = build(child);
    if (d) others.add(d);
  }
  const r = deck.width;
  for (const o of chains) {
    if (o === c || o.maxX < c.minX - r || o.minX > c.maxX + r || o.maxZ < c.minZ - r || o.minZ > c.maxZ + r) continue;
    const d = build(o);
    if (d && d !== deck && !hosts.has(d)) others.add(d);
  }
  const sections = bridgeSections(deck);
  const gaps: BridgeParapetGap[] = [];
  // Over an ACUTE crotch fillet the child's edge runs along its host's line up to where the fillet's
  // circle touches it: no wall there (the two slabs are one), only along the circle.
  for (const f of crotchFlares(deck)) {
    if (!f.acute) continue;
    const [t0, t1] = bridgeTrimRange(deck);
    const tEnd = f.which === 0 ? t0 : t1;
    const tb = f.t + (f.dir * f.hostTouch) / deck.length;
    gaps.push({ side: f.side, t0: Math.min(tEnd, tb), t1: Math.max(tEnd, tb) });
  }
  // No wall stands over road pavement anywhere along the deck (a deck landing obliquely would wall
  // off the road's far lanes): wherever a parapet's line lies over pavement (pavedAt) it opens, exactly to the pavement's edge; it stays
  // only where the deck's edge borders sand, grass, water or a block.
  const line = bridgeParapetLine(deck);
  for (const side of [1, -1] as const) {
    const at = (i: number, f: number): PointXZ => {
      const a = sections[i];
      const q = sections[i + 1];
      return {
        x: a.x + (q.x - a.x) * f + (a.ax + (q.ax - a.ax) * f) * side * line,
        z: a.z + (q.z - a.z) * f + (a.az + (q.az - a.az) * f) * side * line,
      };
    };
    const tAt = (i: number, f: number): number => sections[i].t + (sections[i + 1].t - sections[i].t) * f;
    const pavedOn = (i: number, f: number): boolean => {
      const p = at(i, f);
      return pavedAt(p.x, p.z);
    };
    let open = -1;
    let prevI = 0;
    let prevF = 0;
    let prev = false;
    for (let i = 0; i + 1 < sections.length; i++) {
      const len = Math.hypot(sections[i + 1].x - sections[i].x, sections[i + 1].z - sections[i].z);
      const n = Math.max(1, Math.ceil(len / BRIDGE_PAVED_WALL_STEP));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const f = k / n;
        const paved = pavedOn(i, f);
        if (!(i === 0 && k === 0) && paved !== prev) {
          // The pavement's edge between the two samples (within one quad, or at a section).
          let lo = prevI === i ? prevF : 0;
          let hi = f;
          for (let it = 0; it < 8; it++) {
            const m = (lo + hi) / 2;
            if (pavedOn(i, m) === prev) lo = m;
            else hi = m;
          }
          const tEdge = tAt(i, paved ? lo : hi);
          if (paved) open = tEdge;
          else if (open >= 0) {
            gaps.push({ side, t0: open, t1: tEdge });
            open = -1;
          }
        } else if (i === 0 && k === 0 && paved) open = sections[0].t;
        prev = paved;
        prevI = i;
        prevF = f;
      }
    }
    if (open >= 0) gaps.push({ side, t0: open, t1: sections[sections.length - 1].t });
  }
  // Every wall stands on the OUTER edge of the merged slabs, one continuous line: a wall opens wherever
  // just outside its own drawn edge (fillets and flares included) lies another merged deck's DRAWN slab —
  // its hosts' too. So the host's wall runs on to exactly where a child's fillet leaves its edge and the
  // fillet's wall takes over there, and at a T's corner the host's wall ends on the child's side wall
  // (clipping each wall against the other deck's strip instead leaves a stray wall in the middle of a
  // Y, gaps and jogged, overlapping corners).
  const merging = [...others, ...hosts];
  mergedWith.set(deck, merging);
  if (merging.length > 0) {
    for (const side of [1, -1] as const) {
      const coveredAt = (i: number, f: number): boolean => {
        const a = sections[i];
        const q = sections[i + 1];
        const w = (side === 1 ? a.wl + (q.wl - a.wl) * f : a.wr + (q.wr - a.wr) * f) + BRIDGE_WALL_OUTSIDE;
        const x = a.x + (q.x - a.x) * f + (a.ax + (q.ax - a.ax) * f) * side * w;
        const z = a.z + (q.z - a.z) * f + (a.az + (q.az - a.az) * f) * side * w;
        return merging.some((o) => drawnOn(o, x, z));
      };
      let open = -1;
      let prev = false;
      for (let i = 0; i + 1 < sections.length; i++) {
        const len = Math.hypot(sections[i + 1].x - sections[i].x, sections[i + 1].z - sections[i].z);
        const n = Math.max(1, Math.ceil(len / BRIDGE_COVERED_WALL_STEP));
        for (let k = i === 0 ? 0 : 1; k <= n; k++) {
          const f = k / n;
          const now = coveredAt(i, f);
          if (now !== prev && !(i === 0 && k === 0)) {
            let lo = k === 0 ? 0 : (k - 1) / n;
            let hi = f;
            for (let it = 0; it < 10; it++) {
              const m = (lo + hi) / 2;
              if (coveredAt(i, m) === prev) lo = m;
              else hi = m;
            }
            const tEdge = sections[i].t + (sections[i + 1].t - sections[i].t) * (now ? lo : hi);
            if (now) open = tEdge;
            else if (open >= 0) {
              gaps.push({ side, t0: open, t1: tEdge });
              open = -1;
            }
          } else if (i === 0 && k === 0 && now) open = sections[0].t;
          prev = now;
        }
      }
      if (open >= 0) gaps.push({ side, t0: open, t1: sections[sections.length - 1].t });
    }
  }
  if (gaps.length > 0) {
    const [tLo, tHi] = bridgeTrimRange(deck);
    const merged: BridgeParapetGap[] = [];
    for (const side of [1, -1] as const) {
      const ivs = mergeIntervals(gaps.filter((g) => g.side === side && g.t1 > g.t0).map((g) => [g.t0, g.t1]));
      // What stands between two openings, or between one and the deck's end, only that briefly is a
      // stray stub, not a wall: it opens too.
      const minRun = BRIDGE_MIN_WALL_RUN / deck.length;
      const kept: number[][] = [];
      for (const iv of ivs) {
        const last = kept[kept.length - 1];
        if (last && iv[0] - last[1] < minRun) last[1] = Math.max(last[1], iv[1]);
        else kept.push([...iv]);
      }
      if (kept.length > 0 && kept[0][0] - tLo < minRun) kept[0][0] = Math.min(kept[0][0], tLo);
      if (kept.length > 0 && tHi - kept[kept.length - 1][1] < minRun) kept[kept.length - 1][1] = Math.max(kept[kept.length - 1][1], tHi);
      for (const [t0, t1] of kept) merged.push({ side, t0, t1 });
    }
    deck.gaps = merged;
  }

  // Lane paint: the dash phase of the road at each landed end, and none across a junction.
  const paint = deck.paint;
  const off: number[][] = [];
  for (const which of [0, 1] as const) {
    if (c.ends[which].kind !== "landed") continue;
    const p = deck.path[which === 0 ? 0 : deck.path.length - 1];
    const q = deck.path[which === 0 ? 1 : deck.path.length - 2];
    const ol = Math.hypot(p.x - q.x, p.z - q.z) || 1;
    const v = computeVertexData(p.x, p.z);
    if (!(v.distanceToFreewayCenter < 1000)) {
      const w = Math.min(1, BRIDGE_PAINT_END_CLEAR / deck.length);
      off.push(which === 0 ? [0, w] : [1 - w, 1]);
      continue;
    }
    const along = v.freewayAlong;
    const v2 = computeVertexData(p.x + ((p.x - q.x) / ol) * 4, p.z + ((p.z - q.z) / ol) * 4);
    let rate = v2.distanceToFreewayCenter < 1000 ? (v2.freewayAlong - along) / 4 : 1;
    if (!(Math.abs(rate) > 0.5 && Math.abs(rate) < 2)) rate = rate < 0 ? -1 : 1;
    if (which === 0) {
      paint.has0 = true;
      paint.a0 = along;
      paint.r0 = rate;
    } else {
      paint.has1 = true;
      paint.a1 = along;
      paint.r1 = rate;
    }
  }
  for (const h of hosts) others.add(h);
  if (others.size > 0) {
    const steps = Math.max(2, Math.ceil(deck.length / 2));
    let from = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const s = sections.find((q) => q.t >= t) ?? sections[sections.length - 1];
      let near = false;
      for (const o of others) if (pathDistance(o, s.x, s.z) < o.width / 2 + BRIDGE_PAINT_JUNCTION_CLEAR) near = true;
      if (near && from < 0) from = t;
      if ((!near || k === steps) && from >= 0) {
        off.push([Math.max(0, from - 1 / steps), Math.min(1, t)]);
        from = -1;
      }
    }
  }
  paint.off = mergeIntervals(off).map(([t0, t1]) => [t0, t1] as [number, number]);
  // A crossing of its own is painted only as a painted road carried on at every landed end (a mouth
  // branch's other end is its trunk): a street deck, or one landing on a quay, has no lanes to continue.
  if (c.synth) {
    const painted = ([0, 1] as const).every((w) => c.ends[w].kind !== "landed" || (w === 0 ? paint.has0 : paint.has1));
    if (crossingGeom(c.synth).street || !painted) paint.off = [[0, 1]];
  }
};

/** Step 5b: where two merged decks' walls end at one corner, a wall runs on until it meets the other's —
 *  along its own slab's edge where that is the merged outer edge, else straight along its own line to
 *  the other's inner face: a butt joint with a small overlap, not a miter. Only walls and colliders: the
 *  run-ons are drawn over the slabs, which (and so the ground cut) stay as they are. */

/** A standing wall's end: its outer and inner corners on the slab top, the unit direction it would run
 *  on in (out of the wall, along its edge), its height fraction there, the standing run behind it, and
 *  its section with the step (±1) from there into the opening. */
export interface BridgeWallEnd {
  side: 1 | -1;
  t: number;
  ox: number;
  oy: number;
  oz: number;
  ix: number;
  iy: number;
  iz: number;
  dx: number;
  dz: number;
  wall: number;
  run: number;
  section: number;
  step: 1 | -1;
}

/** A parapet whose drawn height is under this does not stand (the ribbon's own skip). */
const WALL_DRAWN_MIN = 1e-3;
/** A wall end lower than this (a landed end's walls rising out of the ground) joins nothing. */
const WALL_END_MIN = 0.05;
/** Another deck's wall end within this of one is its partner at the corner. */
export const BRIDGE_WALL_PARTNER_REACH = 12;
/** A wall runs on at most this far (the measured corner gaps are 0.05–3u, a fillet's tip ~4u). */
const BRIDGE_WALL_JOIN_MAX = 5;
/** Two walls within this angle of one line are collinear: the one ending first runs on to the other's start. */
const COLLINEAR_COS = Math.cos((25 * Math.PI) / 180);
/** …and only if the other's line runs within this laterally of its own. */
const COLLINEAR_LATERAL = 2;
/** The run-on is checked against the slabs and the pavement this often, its outer face this far inside. */
const JOIN_SAMPLE = 0.25;
const JOIN_INSET = 0.05;
/** A run-on along the slab's edge advances this finely, and stays on the merged slabs' OUTER edge:
 *  nothing drawn this far outside it — but for its last EDGE_CLOSING, where the edge closes on the
 *  partner's at a narrow angle. */
const EDGE_STEP = 0.1;
const EDGE_OUTSIDE = 0.1;
const EDGE_CLOSING = 1;
/** Met at the partner's end, the last leg reaches this far at most (its inner corner onto the partner's). */
const EDGE_MEETING = 3 * BRIDGE_PARAPET_WIDTH;

const point = (s: BridgeSection, lateral: number): [number, number, number] => [s.x + s.ax * lateral, s.y + s.slope * lateral, s.z + s.az * lateral];
const halfOf = (s: BridgeSection, side: 1 | -1): number => (side === 1 ? s.wl : s.wr);

const standingChords = (b: FreewayBridge, S: BridgeSection[], side: 1 | -1): boolean[] => {
  const out: boolean[] = [];
  for (let i = 0; i + 1 < S.length; i++) out.push(bridgeParapetAt(b, (S[i].t + S[i + 1].t) / 2, side) && S[i].wall + S[i + 1].wall > WALL_DRAWN_MIN);
  return out;
};

/** Every standing wall end of a deck, from its sections and its parapet gaps (what the ribbon draws). */
export const bridgeWallEnds = (b: FreewayBridge): BridgeWallEnd[] => {
  const S = bridgeSections(b);
  const PW = BRIDGE_PARAPET_WIDTH;
  const out: BridgeWallEnd[] = [];
  for (const side of [1, -1] as const) {
    const standing = standingChords(b, S, side);
    const end = (i: number, from: number, run: number): void => {
      const s = S[i];
      if (s.wall < WALL_END_MIN) return;
      const o = point(s, side * halfOf(s, side));
      const q = point(S[from], side * halfOf(S[from], side));
      const inner = point(s, side * (halfOf(s, side) - PW));
      const l = Math.hypot(o[0] - q[0], o[2] - q[2]);
      if (l < 1e-6) return;
      out.push({
        side, t: s.t, ox: o[0], oy: o[1], oz: o[2], ix: inner[0], iy: inner[1], iz: inner[2], dx: (o[0] - q[0]) / l, dz: (o[2] - q[2]) / l,
        wall: s.wall, run, section: i, step: i > from ? 1 : -1,
      });
    };
    for (let i = 0; i < standing.length; ) {
      if (!standing[i]) {
        i++;
        continue;
      }
      let j = i;
      let run = 0;
      while (j < standing.length && standing[j]) {
        run += Math.hypot(S[j + 1].x - S[j].x, S[j + 1].z - S[j].z);
        j++;
      }
      end(i, i + 1, run);
      end(j, j - 1, run);
      i = j;
    }
  }
  return out;
};

/** A deck's standing walls' footprints (outer and inner corners at both sections of each chord, x/z). */
export const bridgeWallFootprints = (b: FreewayBridge): number[][] => {
  const S = bridgeSections(b);
  const PW = BRIDGE_PARAPET_WIDTH;
  const out: number[][] = [];
  for (const side of [1, -1] as const) {
    const standing = standingChords(b, S, side);
    for (let i = 0; i < standing.length; i++) {
      if (!standing[i]) continue;
      const a = S[i];
      const c = S[i + 1];
      const ao = point(a, side * halfOf(a, side));
      const co = point(c, side * halfOf(c, side));
      const ci = point(c, side * (halfOf(c, side) - PW));
      const ai = point(a, side * (halfOf(a, side) - PW));
      out.push([ao[0], ao[2], co[0], co[2], ci[0], ci[2], ai[0], ai[2]]);
    }
  }
  return out;
};

/** A run-on along an edge has met the partner's wall within this. */
const EDGE_TOUCH = 0.05;
/** Distance from a point to a wall footprint quad (0 inside). */
const quadDistance = (q: number[], x: number, z: number): number => {
  if (inQuad(q, x, z)) return 0;
  let d = Infinity;
  for (let k = 0; k < 4; k++) d = Math.min(d, distanceToSegment(x, z, q[2 * k], q[2 * k + 1], q[(2 * k + 2) % 8], q[(2 * k + 3) % 8]));
  return d;
};

const inQuad = (q: number[], x: number, z: number): boolean => {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const ax = q[2 * k];
    const az = q[2 * k + 1];
    const cx = q[(2 * k + 2) % 8];
    const cz = q[(2 * k + 3) % 8];
    const cr = (cx - ax) * (z - az) - (cz - az) * (x - ax);
    if (Math.abs(cr) < 1e-12) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
};

/** λ where the line p + λ·d meets the line q + μ·e (NaN when parallel). */
const lineMeet = (px: number, pz: number, dx: number, dz: number, qx: number, qz: number, ex: number, ez: number): number => {
  const den = dx * -ez - dz * -ex;
  if (Math.abs(den) < 1e-9) return NaN;
  return ((qx - px) * -ez - (qz - pz) * -ex) / den;
};

/** How far a wall end runs on STRAIGHT to its partner's: to where its INNER corner meets the partner's
 *  inner face line (the partner running on to this one's closes the corner), or — the two near one
 *  line — to the partner's start when this one ends first. 0 when it already reaches or the corner is
 *  no such join. */
const bridgeWallRunOn = (e: BridgeWallEnd, f: BridgeWallEnd): number => {
  const cos = -(e.dx * f.dx + e.dz * f.dz);
  if (cos > COLLINEAR_COS) {
    const mx = (f.ox + f.ix) / 2 - (e.ox + e.ix) / 2;
    const mz = (f.oz + f.iz) / 2 - (e.oz + e.iz) / 2;
    if (Math.abs(mx * e.dz - mz * e.dx) > COLLINEAR_LATERAL) return 0;
    const along = mx * e.dx + mz * e.dz;
    return along > 0 && along <= BRIDGE_WALL_JOIN_MAX ? along : 0;
  }
  // e.i + λ·e.d = f.i + μ·f.d
  const den = e.dx * -f.dz - e.dz * -f.dx;
  if (Math.abs(den) < 1e-9) return 0;
  const rx = f.ix - e.ix;
  const rz = f.iz - e.iz;
  const lambda = (rx * -f.dz - rz * -f.dx) / den;
  const mu = (e.dx * rz - e.dz * rx) / den;
  if (!(lambda > 0 && lambda <= BRIDGE_WALL_JOIN_MAX) || mu < -f.run || mu > BRIDGE_WALL_JOIN_MAX) return 0;
  return lambda;
};

/** The two decks of one corner: where a point lies on either's drawn slab, and the higher top there. */
const pairOf = (own: FreewayBridge, mate: FreewayBridge) => ({
  onSlab: (x: number, z: number): boolean => drawnOn(own, x, z) || drawnOn(mate, x, z),
  topAt: (x: number, z: number, fallback: number): number => {
    const y = Math.max(...[own, mate].map((d) => bridgeDrawnTopAt(d, x, z)).filter(Number.isFinite));
    return Number.isFinite(y) ? y : fallback;
  },
});

/** A wall end's straight run-on of `len` (bridgeWallRunOn): both faces over the two slabs (the outer
 *  one a hair inside — where its own deck runs straight on it lies exactly on its slab's edge) and off
 *  the pavement; standing on the higher slab. */
const straightRunOn = (own: FreewayBridge, mate: FreewayBridge, e: BridgeWallEnd, len: number): number[] | null => {
  const { onSlab, topAt } = pairOf(own, mate);
  const nx = e.ix - e.ox;
  const nz = e.iz - e.oz;
  const nl = Math.hypot(nx, nz) || 1;
  const steps = Math.max(1, Math.ceil(len / JOIN_SAMPLE));
  for (let k = 0; k <= steps; k++) {
    const a = (len * k) / steps;
    const ox = e.ox + e.dx * a + (nx / nl) * JOIN_INSET;
    const oz = e.oz + e.dz * a + (nz / nl) * JOIN_INSET;
    const ix = e.ix + e.dx * a;
    const iz = e.iz + e.dz * a;
    if (!onSlab(ox, oz) || !onSlab(ix, iz) || pavedAt(ox, oz) || pavedAt(ix, iz)) return null;
  }
  const ox = e.ox + e.dx * len;
  const oz = e.oz + e.dz * len;
  const ix = e.ix + e.dx * len;
  const iz = e.iz + e.dz * len;
  return [e.ox, e.oy, e.oz, e.ix, e.iy, e.iz, ox, topAt(ox, oz, e.oy), oz, ix, topAt(ix, iz, e.iy), iz];
};

/** A wall end's run-on along its own slab's EDGE, while that edge is the two slabs' outer edge (but for
 *  its last EDGE_CLOSING) and off the pavement, until it meets the partner's wall (`walls`): both
 *  corners in, or the outer one in and the inner one butted onto the partner's inner face — or, met at
 *  the partner's end, a wedge turning onto its end cap. */
const edgeRunOn = (own: FreewayBridge, mate: FreewayBridge, e: BridgeWallEnd, f: BridgeWallEnd, walls: number[][]): number[] | null => {
  const { onSlab, topAt } = pairOf(own, mate);
  const S = bridgeSections(own);
  const PW = BRIDGE_PARAPET_WIDTH;
  const at = [e.ox, e.oy, e.oz, e.ix, e.iy, e.iz];
  const inside = (x: number, z: number) => walls.some((q) => inQuad(q, x, z));
  const reached = (x: number, z: number) => walls.some((q) => quadDistance(q, x, z) <= EDGE_TOUCH);
  const lat = (s: BridgeSection, inset: number) => point(s, e.side * (halfOf(s, e.side) - inset));
  let run = 0;
  let covered = 0;
  for (let k = e.section; run < BRIDGE_WALL_JOIN_MAX; k += e.step) {
    const next = k + e.step;
    if (next < 0 || next >= S.length) return null;
    const [ao, ai, co, ci] = [lat(S[k], 0), lat(S[k], PW), lat(S[next], 0), lat(S[next], PW)];
    const len = Math.hypot(co[0] - ao[0], co[2] - ao[2]);
    const n = Math.max(1, Math.ceil(len / EDGE_STEP));
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      const o = ao.map((v, q) => v + (co[q] - v) * u);
      const i = ai.map((v, q) => v + (ci[q] - v) * u);
      if (inside(o[0], o[2]) && inside(i[0], i[2])) {
        // In the partner's wall: done once past its end's inner corner too (else a sliver stays open
        // beside its cap), within EDGE_MEETING.
        const ahead = ((f.ix - i[0]) * (ci[0] - ai[0]) + (f.iz - i[2]) * (ci[2] - ai[2])) / len;
        if (ahead <= 0 || ahead > EDGE_MEETING || pavedAt(o[0], o[2]) || pavedAt(i[0], i[2])) return [...at, ...o, ...i];
        continue;
      }
      const ro = reached(o[0], o[2]);
      if (ro && Math.hypot(o[0] - f.ox, o[2] - f.oz) <= EDGE_MEETING) {
        // Met at the partner's end: a last wedge turns the wall's end about its outer corner onto the
        // partner's end cap — through the corner where the two inner faces meet when that is near (else a
        // notch stays open on the inside of the corner), straight across where they meet only far off
        // (two edges converging at a narrow angle).
        const dx = (ci[0] - ai[0]) / len;
        const dz = (ci[2] - ai[2]) / len;
        const lambda = lineMeet(i[0], i[2], dx, dz, f.ix, f.iz, f.dx, f.dz);
        if (lambda > 0 && lambda <= EDGE_MEETING) {
          const px = i[0] + dx * lambda;
          const pz = i[2] + dz * lambda;
          if (!pavedAt(px, pz) && onSlab(px, pz)) return [...at, ...o, ...i, ...o, px, topAt(px, pz, i[1]), pz, ...o, f.ix, f.iy, f.iz];
        }
        return [...at, ...o, ...i, ...o, f.ix, f.iy, f.iz];
      }
      if (ro) {
        // The outer corner is in: the inner one runs on along its own line to the partner's inner face.
        const dx = (ci[0] - ai[0]) / len;
        const dz = (ci[2] - ai[2]) / len;
        const lambda = lineMeet(i[0], i[2], dx, dz, f.ix, f.iz, f.dx, f.dz);
        if (!(lambda >= 0 && lambda <= EDGE_MEETING)) return null;
        const px = i[0] + dx * lambda;
        const pz = i[2] + dz * lambda;
        if (pavedAt(px, pz) || !onSlab(px, pz)) return null;
        return [...at, ...o, px, topAt(px, pz, i[1]), pz];
      }
      if (pavedAt(o[0], o[2]) || pavedAt(i[0], i[2]) || run + len * u > BRIDGE_WALL_JOIN_MAX) return null;
      // Outward: the edge's normal on the wall's outer side.
      let ux = -(co[2] - ao[2]) / len;
      let uz = (co[0] - ao[0]) / len;
      if (ux * (o[0] - i[0]) + uz * (o[2] - i[2]) < 0) {
        ux = -ux;
        uz = -uz;
      }
      covered = onSlab(o[0] + ux * EDGE_OUTSIDE, o[2] + uz * EDGE_OUTSIDE) ? covered + len / n : 0;
      if (covered > EDGE_CLOSING) return null;
    }
    at.push(...co, ...ci);
    run += len;
  }
  return null;
};

/** Each standing wall end of an owned deck that has a partner — another merged deck's wall end within
 *  BRIDGE_WALL_PARTNER_REACH — is joined to it. ONE of the two closes a corner: the end whose run-on
 *  along its own slab's edge reaches the other (edgeRunOn; this end first, then the partner's); where
 *  neither edge gets there (the edge runs on under the other deck), each runs on STRAIGHT along its own
 *  line to the other's inner face (bridgeWallRunOn) — a butt joint with a small overlap. A pure
 *  function of the two decks' outlines and walls, so the partner's owner decides the same corner alike. */
export const joinMergeWalls = (b: FreewayBridge, partners: FreewayBridge[]): void => {
  if (partners.length === 0) return;
  const ends = bridgeWallEnds(b);
  if (ends.length === 0) return;
  const mine = bridgeWallFootprints(b);
  const theirs = partners.map((deck) => ({ deck, ends: bridgeWallEnds(deck), walls: bridgeWallFootprints(deck) }));
  const joins: BridgeWallJoin[] = [];
  for (const e of ends) {
    let best = BRIDGE_WALL_PARTNER_REACH;
    let mate: (typeof theirs)[number] | null = null;
    let f: BridgeWallEnd | null = null;
    for (const p of theirs) {
      for (const q of p.ends) {
        const d = Math.hypot(q.ox - e.ox, q.oz - e.oz);
        if (d <= best) {
          best = d;
          mate = p;
          f = q;
        }
      }
    }
    if (!mate || !f) continue;
    let at = edgeRunOn(b, mate.deck, e, f, mate.walls);
    if (!at && !edgeRunOn(mate.deck, b, f, e, mine)) {
      const len = bridgeWallRunOn(e, f);
      if (len > 0) at = straightRunOn(b, mate.deck, e, len);
    }
    if (at) joins.push({ side: e.side, wall: e.wall, at });
  }
  if (joins.length > 0) b.wallJoins = joins;
};
