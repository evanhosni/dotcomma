/** Step 5: an owned deck's parapet gaps and lane paint, against every deck it meets. */

import type { PointXZ } from "../../math/types";
import { computeVertexData } from "../vertexCompute";
import { crossingGeom } from "./crossings";
import { bridgeParapetLine, bridgeSections, bridgeTrimRange, crotchFlares, pathDistance } from "./deckGeometry";
import { drawnOn } from "./drawnSlab";
import { pavedAt } from "./landings";
import { mergeIntervals } from "./polyline";
import type { BridgeChain, BridgeParapetGap, FreewayBridge } from "./types";
import { teeHostChain } from "./wetItems";

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

/** An owned deck's parapet gaps and lane paint, against every deck it meets — its hosts, its
 *  T-children, and any deck overlapping it: its walls stand only on the outer edge of their merged
 *  slabs, never over pavement, and never as a stub. */
export const finishDeck = (c: BridgeChain, chains: BridgeChain[], build: (c: BridgeChain) => FreewayBridge | null): void => {
  const deck = c.deck!;
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
  // (clipping each wall against the other deck's strip left a stray wall in the middle of a Y, gaps and
  // jogged, overlapping corners — Evan, screenshots).
  const merging = [...others, ...hosts];
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
