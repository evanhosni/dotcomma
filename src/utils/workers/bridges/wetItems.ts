/** Steps 2–3: a road path's wet stretches (WetItems) and how their open ends join — end to end into
 *  one chain when nearly straight, as a T onto a deck passing by, or not at all. */

import { warp } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { BRIDGE_EDGE_GUARD, BRIDGE_MAX_DEVIATION, BRIDGE_TEE_OFF_HOST, BRIDGE_WET_MERGE, deckWidth, runRiverYield } from "./constants";
import { dropShortLegs, filletCorners, polyPointAt, projectOnPolyline, simplifyPolyline } from "./polyline";
import type { BridgeChain, BridgeWindow, ChainEnd, FreewayBridge, RoadPath, WetItem, WindowScan } from "./types";

/** An open end joins a deck passing within JUNCTION_REACH; within END_MEET of another open end
 *  the two continue as one. */
const BRIDGE_JUNCTION_REACH = 6;
const BRIDGE_END_MEET = 10;

/** Two open ends meeting continue as ONE deck only this close to straight (the directions into the
 *  two items at least this opposite: cos 35°); anything sharper would be a V kink over the water. */
const BRIDGE_JOIN_STRAIGHT_COS = Math.cos((35 * Math.PI) / 180);

export const teeHostChain = (e: ChainEnd): BridgeChain | null => (e.kind === "tee" ? (e.hostChain ?? e.host?.chain ?? null) : null);

/** A T end the host's deck no longer passes through (its corner rounded — filletCorners, smoothKink)
 *  is carried on along its own last leg onto the host's centerline, at most TEE_EXTEND_MAX (a run
 *  ending at a belt corner would otherwise drop as "off the host's rounded corner" and end against
 *  the deck's parapet). The chain's midpoint (its identity and owner) is kept. */
const TEE_EXTEND_MAX = 16;
export const extendOntoRoundedHost = (c: BridgeChain, which: 0 | 1, host: FreewayBridge): void => {
  const n = c.path.length;
  if (n < 2) return;
  const p = which === 0 ? c.path[0] : c.path[n - 1];
  const q = which === 0 ? c.path[1] : c.path[n - 2];
  const hx = host.path.map((v) => v.x);
  const hz = host.path.map((v) => v.z);
  if (projectOnPolyline(hx, hz, p.x, p.z).d <= BRIDGE_TEE_OFF_HOST) return;
  const l = Math.hypot(p.x - q.x, p.z - q.z);
  if (l < 1e-9) return;
  const dx = (p.x - q.x) / l;
  const dz = (p.z - q.z) / l;
  let best = Infinity;
  for (let i = 0; i + 1 < hx.length; i++) {
    const sx = hx[i + 1] - hx[i];
    const sz = hz[i + 1] - hz[i];
    const den = dx * sz - dz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((hx[i] - p.x) * sz - (hz[i] - p.z) * sx) / den;
    const u = ((hx[i] - p.x) * dz - (hz[i] - p.z) * dx) / den;
    if (t > 0 && t <= TEE_EXTEND_MAX && u >= 0 && u <= 1 && t < best) best = t;
  }
  if (best === Infinity) return;
  const e = { x: p.x + dx * best, z: p.z + dz * best };
  if (which === 0) {
    c.path = [e, ...c.path];
    c.cum = [0, ...c.cum.map((v) => v + best)];
  } else {
    c.path = [...c.path, e];
    c.cum = [...c.cum, c.length + best];
  }
  c.length += best;
};

const nearWindowEdge = (w: BridgeWindow, wx: number, wz: number): boolean =>
  wx - w.x0 < BRIDGE_EDGE_GUARD || w.x1 - wx < BRIDGE_EDGE_GUARD || wz - w.z0 < BRIDGE_EDGE_GUARD || w.z1 - wz < BRIDGE_EDGE_GUARD;

/** 2. The maximal wet stretches of every path. A sample is WET when any point of the road's
 *  cross-section — its centerline or either edge of the deck it would carry — is inside a footprint
 *  by the very field the terrain uses (riverFieldAt): the terrain yields the road to the river
 *  there (sand, no paint), so a deck landed where the WHOLE section is dry covers every such point.
 *  (The centerline alone leaves a wedge of the road's curbed end showing past an oblique deck's end
 *  on one side.) */
export const findWetItems = (paths: RoadPath[], scan: WindowScan, abutment: number): WetItem[] => {
  const half = deckWidth() / 2;
  const items: WetItem[] = [];
  for (const path of paths) {
    // The same field the terrain yields this road at (computeVertexData step 5, runRiverYield).
    const yieldAt = path.kind === "run" ? runRiverYield() : scan.reach;
    const wetAt = (x: number, z: number): boolean => {
      riverFieldAt(x, z);
      return riverSample.distance < yieldAt;
    };
    const n = path.wx.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]));
    const wet = path.wx.map((wx, i) => {
      if (wetAt(wx, path.wz[i])) return true;
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = path.x[b] - path.x[a];
      const dz = path.z[b] - path.z[a];
      const l = Math.hypot(dx, dz) || 1;
      for (const side of [1, -1]) {
        const e = warp(path.x[i] - (dz / l) * half * side, path.z[i] + (dx / l) * half * side);
        if (wetAt(e.x, e.z)) return true;
      }
      return false;
    });
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
      const open0 = a === 0 && !path.landed?.[0];
      const open1 = b === n - 1 && !path.landed?.[1];
      // A landed end lies `abutment` past the last wet sample along the segment beyond it, found from
      // those two samples alone: an arc length summed from the path's start rounds differently
      // wherever the window clipped the path, and a wider window drew the same deck a few ulps apart.
      const sample = (i: number) => ({ wx: path.wx[i], wz: path.wz[i], x: path.x[i], z: path.z[i] });
      const beyond = (i: number, j: number) => {
        const l = Math.hypot(path.x[j] - path.x[i], path.z[j] - path.z[i]);
        const t = l > 0 ? Math.min(1, abutment / l) : 0;
        return { wx: path.wx[i] + (path.wx[j] - path.wx[i]) * t, wz: path.wz[i] + (path.wz[j] - path.wz[i]) * t, x: path.x[i] + (path.x[j] - path.x[i]) * t, z: path.z[i] + (path.z[j] - path.z[i]) * t };
      };
      const first = open0 ? 0 : Math.max(0, a - 1);
      const lastI = open1 ? n - 1 : Math.min(n - 1, b + 1);
      let edge = false;
      for (let i = first; i <= lastI && !edge; i++) edge = nearWindowEdge(scan.win, path.wx[i], path.wz[i]);
      const item: WetItem = { index: items.length, kind: path.kind, wx: [], wz: [], x: [], z: [], open: [open0, open1], edge, chain: null };
      const push = (p: { wx: number; wz: number; x: number; z: number }) => {
        item.wx.push(p.wx);
        item.wz.push(p.wz);
        item.x.push(p.x);
        item.z.push(p.z);
      };
      if (!open0 && first > 0 && abutment > 0) push(beyond(first, first - 1));
      for (let i = first; i <= lastI; i++) push(sample(i));
      if (!open1 && lastI < n - 1 && abutment > 0) push(beyond(lastI, lastI + 1));
      if (item.x.length >= 2) items.push(item);
      a = b + 1;
    }
  }
  return items;
};

/** An OPEN end of a wet item (warped), with the unit direction INTO the item from it. */
interface OpenEnd {
  item: WetItem;
  which: 0 | 1;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

const openEndOf = (item: WetItem, which: 0 | 1): OpenEnd => {
  const n = item.wx.length;
  const [i, j] = which === 0 ? [0, 1] : [n - 1, n - 2];
  const dx = item.wx[j] - item.wx[i];
  const dz = item.wz[j] - item.wz[i];
  const l = Math.hypot(dx, dz) || 1;
  return { item, which, x: item.wx[i], z: item.wz[i], dx: dx / l, dz: dz / l };
};

const endKey = (e: { item: WetItem; which: number }) => `${e.item.index}:${e.which}`;

/** 3a. Joins at the open ends: ends meeting within BRIDGE_END_MEET form a node, whose straightest
 *  pair continues through (`next`, both ways) while the rest tee onto the through item; a lone end
 *  tees onto whatever item passes within BRIDGE_JUNCTION_REACH (`tees`). Keyed by endKey. */
const linkOpenEnds = (items: WetItem[]): { next: Map<string, OpenEnd>; tees: Map<string, { host: WetItem; hx: number; hz: number }> } => {
  const openEnds: OpenEnd[] = [];
  for (const item of items) for (const which of [0, 1] as const) if (item.open[which]) openEnds.push(openEndOf(item, which));
  const parent = openEnds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < openEnds.length; i++) {
    for (let j = i + 1; j < openEnds.length; j++) {
      if (openEnds[i].item === openEnds[j].item) continue;
      if (Math.hypot(openEnds[i].x - openEnds[j].x, openEnds[i].z - openEnds[j].z) < BRIDGE_END_MEET) parent[find(i)] = find(j);
    }
  }
  const nodes = new Map<number, OpenEnd[]>();
  openEnds.forEach((e, i) => {
    const r = find(i);
    const list = nodes.get(r);
    if (list) list.push(e);
    else nodes.set(r, [e]);
  });
  const next = new Map<string, OpenEnd>();
  const tees = new Map<string, { host: WetItem; hx: number; hz: number }>();
  // A host must PASS the end — its deck continuing at least half a deck width either way — or the
  // "T" is two roads meeting at their ends, whose decks would overlap in a wedge.
  const half = deckWidth() / 2;
  const itemLength = new Map<WetItem, number>();
  const lengthOf = (item: WetItem) => {
    let l = itemLength.get(item);
    if (l === undefined) {
      l = 0;
      for (let i = 1; i < item.wx.length; i++) l += Math.hypot(item.wx[i] - item.wx[i - 1], item.wz[i] - item.wz[i - 1]);
      itemLength.set(item, l);
    }
    return l;
  };
  const teeOnto = (e: OpenEnd) => {
    let best: { host: WetItem; d: number } | null = null;
    for (const other of items) {
      if (other === e.item) continue;
      const pr = projectOnPolyline(other.wx, other.wz, e.x, e.z);
      if (pr.d >= BRIDGE_JUNCTION_REACH || pr.s < half || pr.s > lengthOf(other) - half) continue;
      if (!best || pr.d < best.d) best = { host: other, d: pr.d };
    }
    if (best) tees.set(endKey(e), { host: best.host, hx: e.x, hz: e.z });
  };
  for (const group of nodes.values()) {
    // The straightest pair continues through (directions into the items most opposite) — only if
    // it IS nearly straight (two roads meeting at an angle would join into one deck with a V kink
    // over the water). Every other end tees onto a road passing through the node, or drops.
    let pi = -1;
    let pj = -1;
    let bestDot = -BRIDGE_JOIN_STRAIGHT_COS;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const dot = group[i].dx * group[j].dx + group[i].dz * group[j].dz;
        if (dot < bestDot) {
          bestDot = dot;
          pi = i;
          pj = j;
        }
      }
    }
    if (pi >= 0) {
      next.set(endKey(group[pi]), group[pj]);
      next.set(endKey(group[pj]), group[pi]);
    }
    group.forEach((e, k) => {
      if (k !== pi && k !== pj) teeOnto(e);
    });
  }
  return { next, tees };
};

/** 3b. Chains: items linked end to end, each canonically oriented and simplified, with the T links
 *  between them (a host's `children`). */
export const linkWetItems = (items: WetItem[]): BridgeChain[] => {
  const { next, tees } = linkOpenEnds(items);
  const chains: BridgeChain[] = [];
  const seen = new Uint8Array(items.length);
  for (const start of items) {
    if (seen[start.index]) continue;
    // Walk back to the chain's first item (or detect a cycle).
    let item = start;
    let entry: 0 | 1 = 0; // the end we entered the item through, walking forward
    let cyclic = false;
    for (let guard = 0; ; guard++) {
      const back = next.get(`${item.index}:${entry}`);
      if (!back) break;
      item = back.item;
      entry = back.which === 0 ? 1 : 0;
      if (item === start || guard > items.length) {
        cyclic = true;
        break;
      }
    }
    const parts: { item: WetItem; reversed: boolean }[] = [];
    for (let guard = 0; guard <= items.length; guard++) {
      if (seen[item.index]) break;
      seen[item.index] = 1;
      parts.push({ item, reversed: entry === 1 });
      const exit = entry === 0 ? 1 : 0;
      const fwd = next.get(`${item.index}:${exit}`);
      if (!fwd) break;
      item = fwd.item;
      entry = fwd.which;
    }
    const endAt = (part: { item: WetItem; reversed: boolean }, first: boolean): ChainEnd => {
      const which = (first ? (part.reversed ? 1 : 0) : part.reversed ? 0 : 1) as 0 | 1;
      if (cyclic) return { kind: "open" };
      if (!part.item.open[which]) return { kind: "landed" };
      const tee = tees.get(`${part.item.index}:${which}`);
      return tee ? { kind: "tee", ...tee } : { kind: "open" };
    };
    const x: number[] = [];
    const z: number[] = [];
    const wxs: number[] = [];
    const wzs: number[] = [];
    for (const { item: it, reversed } of parts) {
      const n = it.x.length;
      for (let k = 0; k < n; k++) {
        const i = reversed ? n - 1 - k : k;
        if (x.length > 0 && Math.hypot(x[x.length - 1] - it.x[i], z[z.length - 1] - it.z[i]) < 1e-6) continue;
        x.push(it.x[i]);
        z.push(it.z[i]);
        wxs.push(it.wx[i]);
        wzs.push(it.wz[i]);
      }
    }
    const chain: BridgeChain = {
      parts,
      ends: [endAt(parts[0], true), endAt(parts[parts.length - 1], false)],
      merged: parts.length > 1,
      children: [],
      x,
      z,
      wx: wxs,
      wz: wzs,
      path: [],
      cum: [],
      length: 0,
      midX: 0,
      midZ: 0,
      minX: Math.min(...x),
      minZ: Math.min(...z),
      maxX: Math.max(...x),
      maxZ: Math.max(...z),
      state: 0,
      deck: null,
      drop: cyclic ? "cycle" : "",
      edge: parts.some((p) => p.item.edge),
    };
    // Canonical orientation (lexicographically smaller world end first): every chunk agrees.
    const n = x.length;
    if (x[0] > x[n - 1] || (x[0] === x[n - 1] && z[0] > z[n - 1])) {
      x.reverse();
      z.reverse();
      wxs.reverse();
      wzs.reverse();
      chain.ends.reverse();
    }
    const kept = simplifyPolyline(x, z, BRIDGE_MAX_DEVIATION);
    chain.path = dropShortLegs(filletCorners(kept.map((i) => ({ x: x[i], z: z[i] }))));
    chain.cum = [0];
    for (let i = 1; i < chain.path.length; i++) chain.cum.push(chain.cum[i - 1] + Math.hypot(chain.path[i].x - chain.path[i - 1].x, chain.path[i].z - chain.path[i - 1].z));
    chain.length = chain.cum[chain.cum.length - 1];
    const mid = polyPointAt(chain.path, chain.cum, chain.length / 2);
    chain.midX = mid.x;
    chain.midZ = mid.z;
    for (const p of parts) p.item.chain = chain;
    chains.push(chain);
  }
  for (const c of chains) for (const e of c.ends) if (e.kind === "tee") teeHostChain(e)!.children.push(c);
  return chains;
};
