/** Step 6: CROSSINGS OF THEIR OWN — straight decks where a city river has none (an arterial's crossing,
 *  a fill slot every FILL_STEP), and every freeway mouth's deck as a Crossing the deck builder handles
 *  like any chain. */

import { CITY_BIOME_ID } from "../../../world/constants";
import { seedRand } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { getCityDistrict } from "../roads/cityTerrain";
import { domainConfig } from "../computeConfig";
import { unwarp, warp } from "../noise";
import { riverFieldAt, riverSample, riverStraight, riverStraightNear } from "../rivers/riverField";
import { type RiverEdge, riverEdgePiece, type RiverPiece, riverPieceBuilt } from "../rivers/riverNetwork";
import { computeVertexData, freewayDistanceAt } from "../vertexCompute";
import { zoneAtWarped } from "../voronoi";
import { BRIDGE_ALONG_ALIGN, BRIDGE_EDGE_GUARD, BRIDGE_MAX_ALONG_SHORE, BRIDGE_MAX_LENGTH, deckWidth, streetDeckWidth } from "./constants";
import { edgeDirWorld, MOUTH_CLUSTER, MOUTH_PAIR_MAX, mouthPairGeom, mouthSingleGeom, mouthsOf } from "./mouths";
import { polyPointAt, segIntersect } from "./polyline";
import type { BridgeChain, Crossing, CrossingGeom, Mouth, RoadPath, WindowScan } from "./types";

/** The rules keep decks off the shore, which alone leaves long stretches of river through a city
 *  with no deck at all: an arterial crossing at a slant, along a bank or into a T onto a dropped host has no deck, and neither do
 *  the city's streets. So a river with city on both banks gets CROSSINGS OF ITS OWN: where an
 *  arterial crosses it without a deck, and at least one per FILL_STEP along it. Each is STRAIGHT,
 *  at most CROSSING_MAX_SKEW off square to the river, and lands on pavement on both banks — the quay
 *  road counts — so it can never follow a shore, kink, V or end in the water. A fill crossing snaps
 *  onto one of its district's street lines, preferring one whose street goes on past both quays,
 *  and is a street-width deck. */
export const CROSSING_MAX_SKEW = (35 * Math.PI) / 180;
/** An arterial crossing its river shallower than this makes no crossing of its own (a fill one serves). */
const CROSSING_MIN_ROAD_ANGLE = (20 * Math.PI) / 180;

/** One fill crossing per this much of a city river's stretch (at least one per stretch), none
 *  within FILL_CLEAR of another deck; each snaps at most FILL_SNAP_MAX along the river. */
const FILL_STEP = 350;
export const FILL_CLEAR = 180;
export const FILL_SNAP_MAX = 80;
/** Two decks closer than their half-widths + this overlap: the later one gives way. */
export const CROSSING_OVERLAP_CLEAR = 4;
/** Crossings within the verdict's reach + this are tested for overlap (the snaps move both). */
export const CROSSING_NEAR_PAD = 60;
const CROSSING_MARCH = 6;
const CROSSING_SETTLE_STEP = 1.5;
/** A landing's end corners may stand this far past the curb (street units): on the sidewalk band. */
const CROSSING_CORNER_SLACK = 4;
/** The farthest a crossing's landing may lie from the river centerline. */
const CROSSING_MAX_HALF = 450;
/** A crossing's deck midpoint lies within this of its crossing point (the snap, and the two
 *  landings' different distances). */
export const CROSSING_MID_REACH = FILL_SNAP_MAX + CROSSING_MAX_HALF / 2;
/** A crossing's verdict reads the crossings within this (warped) — its window keeps it that far
 *  inside its edge, or the chain counts as at the edge. */
const CROSSING_EDGE = FILL_CLEAR + 2 * FILL_SNAP_MAX + CROSSING_NEAR_PAD + BRIDGE_EDGE_GUARD;

/** Distance from a world box [x0, z0, x1, z1] to a crossing's path bounds (0 when they meet). */
export const boxApart = (box: number[], g: CrossingGeom): number => geomBoxApart({ ...g, path: [{ x: box[0], z: box[1] }, { x: box[2], z: box[3] }] }, g);

/** Distance between the bounding boxes of two crossings' paths (0 when they meet). */
export const geomBoxApart = (a: CrossingGeom, b: CrossingGeom): number => {
  const box = (g: CrossingGeom) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of g.path) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    return [x0, z0, x1, z1];
  };
  const [ax0, az0, ax1, az1] = box(a);
  const [bx0, bz0, bx1, bz1] = box(b);
  return Math.hypot(Math.max(0, ax0 - bx1, bx0 - ax1), Math.max(0, az0 - bz1, bz0 - az1));
};

export const crossingGeoms = new Map<string, CrossingGeom>();
const cityRivers = new Map<string, { mask: Uint8Array; slots: number[] }>();
export const clearCrossingCaches = (): void => {
  crossingGeoms.clear();
  cityRivers.clear();
};

export const crossingBefore = (a: Crossing, b: Crossing): boolean => a.prio > b.prio || (a.prio === b.prio && a.key < b.key);

const geomLength = (g: CrossingGeom): number => {
  let l = 0;
  for (let i = 1; i < g.path.length; i++) l += Math.hypot(g.path[i].x - g.path[i - 1].x, g.path[i].z - g.path[i - 1].z);
  return l;
};

/** Of two mouth crossings in each other's way: a pair's deck, then a branch's, then a lone mouth's;
 *  then the shorter. */
export const mouthRank = (c: Crossing): number => (c.trunk ? 2 : c.faces ? 1.5 : c.mouths!.length === 2 ? 3 : 1);
export const mouthBefore = (a: Crossing, b: Crossing): boolean => {
  if (mouthRank(a) !== mouthRank(b)) return mouthRank(a) > mouthRank(b);
  const la = geomLength(crossingGeom(a));
  const lb = geomLength(crossingGeom(b));
  return Math.abs(la - lb) > 1e-6 ? la < lb : a.key < b.key;
};

/** An edge's pieces through a city — built, city at the quay on both banks — and the fill slots:
 *  per maximal stretch of such pieces, round(length / FILL_STEP) (≥ 1) spread evenly along it. */
const cityRiverOf = (e: RiverEdge): { mask: Uint8Array; slots: number[] } => {
  let entry = cityRivers.get(e.key);
  if (entry) return entry;
  if (cityRivers.size > 4096) dropOldestHalf(cityRivers);
  const mask = new Uint8Array(e.count);
  const quay = domainConfig!.river.halfWidth + domainConfig!.river.bank;
  const road = domainConfig!.cityConfig.roadWidth;
  const step = e.len / e.count;
  const widths = e.widths;
  if (widths) {
    for (let i = 0; i < e.count; i++) {
      const s = (i + 0.5) * step;
      const mx = e.ax + e.ux * s;
      const mz = e.az + e.uz * s;
      const r = (quay * (widths[i] + widths[i + 1])) / 2 + road;
      if (zoneAtWarped(mx - e.uz * r, mz + e.ux * r).biome.id !== CITY_BIOME_ID) continue;
      if (zoneAtWarped(mx + e.uz * r, mz - e.ux * r).biome.id !== CITY_BIOME_ID) continue;
      if (riverEdgePiece(e, i)) mask[i] = 1;
    }
  }
  const slots: number[] = [];
  for (let lo = 0; lo < e.count; ) {
    if (!mask[lo]) {
      lo++;
      continue;
    }
    let hi = lo;
    while (hi + 1 < e.count && mask[hi + 1]) hi++;
    const n = hi - lo + 1;
    const k = Math.max(1, Math.round((n * step) / FILL_STEP));
    for (let j = 0; j < k; j++) slots.push(lo + Math.floor(((j + 0.5) * n) / k));
    lo = hi + 1;
  }
  entry = { mask, slots };
  cityRivers.set(e.key, entry);
  return entry;
};

const newCrossing = (kind: Crossing["kind"], key: string, p: RiverPiece, wx: number, wz: number, x: number, z: number, tx: number, tz: number, prio: number): Crossing => {
  const a = unwarp(p.sx, p.sz);
  const b = unwarp(p.ex, p.ez);
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { key, kind, x, z, wx, wz, rx: (b.x - a.x) / l, rz: (b.z - a.z) / l, tx, tz, prio };
};

/** A mouth crossing: its reference point is its deck's midpoint (known with the mouths), or a lone
 *  mouth's line's centerline hit. */
const mouthCrossing = (e: RiverEdge, key: string, mouths: Mouth[], geom: CrossingGeom | undefined, at: PointXZ, prio: number, trunk?: string): Crossing => {
  let p = at;
  if (geom) {
    const cum = [0];
    for (let i = 1; i < geom.path.length; i++) cum.push(cum[i - 1] + Math.hypot(geom.path[i].x - geom.path[i - 1].x, geom.path[i].z - geom.path[i - 1].z));
    p = polyPointAt(geom.path, cum, cum[cum.length - 1] / 2);
  }
  const w = warp(p.x, p.z);
  const rd = edgeDirWorld(e, w.x, w.z);
  const pts = geom ? geom.path : mouths;
  const r = geom ? 0 : MOUTH_PAIR_MAX * 0.3;
  const box = [Math.min(...pts.map((q) => q.x)) - r, Math.min(...pts.map((q) => q.z)) - r, Math.max(...pts.map((q) => q.x)) + r, Math.max(...pts.map((q) => q.z)) + r];
  return { key, kind: "mouth", mouths, x: p.x, z: p.z, wx: w.x, wz: w.z, rx: rd.x, rz: rd.z, tx: 0, tz: 0, prio, trunk, geom, box };
};

/** 6a. The window's crossing candidates: every fill slot inside it, every point where a city
 *  arterial crosses a city river's centerline, and every freeway mouth's deck (a pair's, a lone
 *  mouth's) — all from canonical samples or whole edges, so every window finds the same ones. */
export const findCrossings = (scan: WindowScan, paths: RoadPath[]): Crossing[] => {
  const built = (scan.built ??= scan.pieces.filter(riverPieceBuilt));
  const { win } = scan;
  const out: Crossing[] = [];
  const edges = new Map<string, RiverEdge>();
  for (const p of built) edges.set(p.edge.key, p.edge);
  for (const e of edges.values()) {
    for (const i of cityRiverOf(e).slots) {
      const p = riverEdgePiece(e, i);
      if (!p) continue;
      const wx = (p.sx + p.ex) / 2;
      const wz = (p.sz + p.ez) / 2;
      if (wx < win.x0 || wx > win.x1 || wz < win.z0 || wz > win.z1) continue;
      const w = unwarp(wx, wz);
      const key = `f${e.key}:${i}`;
      out.push(newCrossing("fill", key, p, wx, wz, w.x, w.z, 0, 0, 1 + 0.5 * seedRand(`${domainConfig!.seed} - bridge fill ${key}`)));
    }
    const inWindow = (w: PointXZ) => w.x >= win.x0 && w.x <= win.x1 && w.z >= win.z0 && w.z <= win.z1;
    // A pair's deck and its branches as one group, wherever any of them reaches into the window: a
    // mouth deck may be long, and every verdict reading it must find it.
    const meets = (g: CrossingGeom) => g.path.some((p) => inWindow(warp(p.x, p.z)));
    const { mouths, pairs, branches, naturals } = mouthsOf(e);
    for (const pair of pairs) {
      const [a, b] = pair.mouths;
      const own = branches.filter((q) => q.trunk === pair);
      if (!meets(pair.geom) && !own.some((q) => meets(q.geom))) continue;
      const key = `mp${e.key}:${a.key}|${b.key}`;
      const junction = (ends: Mouth[]) => mouths.filter((m) => ends.some((q) => m === q || (m.side === q.side && Math.hypot(m.x - q.x, m.z - q.z) < MOUTH_CLUSTER)));
      const trunk = mouthCrossing(e, key, [a, b], pair.geom, a, 5);
      trunk.covers = junction([a, b]);
      out.push(trunk);
      for (const q of own) {
        const v = pair.mouths.find((m) => m.side !== q.mouth.side)!;
        const branch = mouthCrossing(e, `mb${e.key}:${q.mouth.key}>${a.key}|${b.key}`, [q.mouth, v], q.geom, q.mouth, 5, key);
        branch.covers = junction([q.mouth]);
        out.push(branch);
      }
    }
    for (const m of mouths) {
      if (!m.hit) continue;
      const w = warp(m.hit.x, m.hit.z);
      if (inWindow(w)) out.push(mouthCrossing(e, `ms${e.key}:${m.key}`, [m], undefined, m.hit, 4));
    }
    for (const { mouth, faces } of naturals) {
      if (![mouth, ...faces].some((q) => inWindow(warp(q.x, q.z)))) continue;
      const c = mouthCrossing(e, `mn${e.key}:${mouth.key}`, [mouth, ...faces], undefined, mouth, 4);
      c.mouths = [mouth];
      c.faces = faces;
      out.push(c);
    }
  }
  const minSin = Math.sin(CROSSING_MIN_ROAD_ANGLE);
  const seen = new Set<string>();
  for (const path of paths) {
    if (path.kind !== "arterial" && path.kind !== "arterialSeg") continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < path.wx.length; i++) {
      x0 = Math.min(x0, path.wx[i]);
      x1 = Math.max(x1, path.wx[i]);
      z0 = Math.min(z0, path.wz[i]);
      z1 = Math.max(z1, path.wz[i]);
    }
    for (const p of built) {
      if (Math.max(p.sx, p.ex) < x0 || Math.min(p.sx, p.ex) > x1 || Math.max(p.sz, p.ez) < z0 || Math.min(p.sz, p.ez) > z1) continue;
      if (!cityRiverOf(p.edge).mask[p.index]) continue;
      const rdx = p.ex - p.sx;
      const rdz = p.ez - p.sz;
      const rl = Math.hypot(rdx, rdz) || 1;
      for (let i = 0; i + 1 < path.wx.length; i++) {
        const hit = segIntersect(path.wx[i], path.wz[i], path.wx[i + 1], path.wz[i + 1], p.sx, p.sz, p.ex, p.ez);
        if (!hit) continue;
        const lx = path.wx[i + 1] - path.wx[i];
        const lz = path.wz[i + 1] - path.wz[i];
        const ll = Math.hypot(lx, lz) || 1;
        const sin = Math.abs(lx * rdz - lz * rdx) / (ll * rl);
        if (sin < minSin) continue;
        const t = Math.hypot(hit.x - path.wx[i], hit.z - path.wz[i]) / ll;
        const x = path.x[i] + (path.x[i + 1] - path.x[i]) * t;
        const z = path.z[i] + (path.z[i + 1] - path.z[i]) * t;
        const key = `a${Math.round(x * 100)},${Math.round(z * 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tx = path.x[i + 1] - path.x[i];
        const tz = path.z[i + 1] - path.z[i];
        const tl = Math.hypot(tx, tz) || 1;
        out.push(newCrossing("arterial", key, p, hit.x, hit.z, x, z, tx / tl, tz / tl, 2 + sin));
      }
    }
  }
  return out;
};

/** A crossing as a chain the deck builder handles like any other: landed at both ends, its bounds
 *  conservative until its geometry is resolved (resolveCrossingChain). */
export const crossingChain = (scan: WindowScan, c: Crossing): BridgeChain => {
  const pad = CROSSING_MAX_HALF + FILL_SNAP_MAX + deckWidth() / 2;
  const { win } = scan;
  const chain: BridgeChain = {
    parts: [],
    ends: [{ kind: "landed" }, { kind: "landed" }],
    merged: false,
    children: [],
    x: [],
    z: [],
    wx: [],
    wz: [],
    path: [],
    cum: [],
    length: 0,
    midX: c.x,
    midZ: c.z,
    minX: c.x - pad,
    minZ: c.z - pad,
    maxX: c.x + pad,
    maxZ: c.z + pad,
    state: 0,
    deck: null,
    drop: "",
    edge: c.wx - win.x0 < CROSSING_EDGE || win.x1 - c.wx < CROSSING_EDGE || c.wz - win.z0 < CROSSING_EDGE || win.z1 - c.wz < CROSSING_EDGE,
    synth: c,
  };
  if (c.box && !c.geom) {
    chain.minX = c.box[0];
    chain.minZ = c.box[1];
    chain.maxX = c.box[2];
    chain.maxZ = c.box[3];
  }
  if (c.geom) {
    // A mouth deck's verdict reads what lies along its whole extent (mouthPre, mouthVerdict).
    resolveCrossingChain(chain);
    const m = deckWidth() + CROSSING_OVERLAP_CLEAR + BRIDGE_EDGE_GUARD;
    chain.edge = c.geom.path.some((p) => {
      const w = warp(p.x, p.z);
      return w.x - win.x0 < m || win.x1 - w.x < m || w.z - win.z0 < m || win.z1 - w.z < m;
    });
  }
  return chain;
};

/** Sets a crossing chain's path, midpoint and exact bounds from its geometry; false if it has none. */
export const resolveCrossingChain = (c: BridgeChain): boolean => {
  if (c.resolver && !c.resolver()) return false;
  const g = crossingGeom(c.synth!);
  if (!g.ok) return false;
  if (c.path.length === 0) {
    c.path = g.path;
    c.cum = [0];
    for (let i = 1; i < g.path.length; i++) c.cum.push(c.cum[i - 1] + Math.hypot(g.path[i].x - g.path[i - 1].x, g.path[i].z - g.path[i - 1].z));
    c.length = c.cum[c.cum.length - 1];
    const mid = polyPointAt(c.path, c.cum, c.length / 2);
    c.midX = mid.x;
    c.midZ = mid.z;
    c.minX = Math.min(...g.path.map((p) => p.x));
    c.maxX = Math.max(...g.path.map((p) => p.x));
    c.minZ = Math.min(...g.path.map((p) => p.z));
    c.maxZ = Math.max(...g.path.map((p) => p.z));
  }
  return true;
};

export const failedCrossing = (why: string): CrossingGeom => ({ ok: false, why, path: [], ys: [0, 0], x: 0, z: 0, width: 0, street: false });

/** One landing: from the centerline point (x, z) along (ux, uz), past the last point where any of the
 *  deck's cross-section is inside a river's footprint, on to the middle of the road met there (the
 *  quay, or the road the deck continues). `cont`: a street goes on beyond it. */
const landCrossing = (x: number, z: number, ux: number, uz: number, W: number): { s: number; y: number; cont: number } | string => {
  const reach = domainConfig!.river.halfWidth + domainConfig!.river.bank;
  const rw = domainConfig!.cityConfig.roadWidth;
  const half = W / 2;
  const nx = -uz;
  const nz = ux;
  const wetAt = (px: number, pz: number): boolean => {
    const w = warp(px, pz);
    riverFieldAt(w.x, w.z);
    return riverSample.distance < reach;
  };
  const wet = (s: number): boolean => {
    const px = x + ux * s;
    const pz = z + uz * s;
    return wetAt(px, pz) || wetAt(px + nx * half, pz + nz * half) || wetAt(px - nx * half, pz - nz * half);
  };
  let s = CROSSING_MARCH;
  while (s <= CROSSING_MAX_HALF && wet(s)) s += CROSSING_MARCH;
  if (s > CROSSING_MAX_HALF) return "no dry bank";
  let lo = s - CROSSING_MARCH;
  let hi = s;
  for (let it = 0; it < 5; it++) {
    const m = (lo + hi) / 2;
    if (wet(m)) lo = m;
    else hi = m;
  }
  const field = (d: number): number => computeVertexData(x + ux * d, z + uz * d).distanceToRoadCenter;
  let best = hi;
  let bestF = field(hi);
  for (let k = 1; k * CROSSING_SETTLE_STEP <= 2 * rw + 4; k++) {
    const d = hi + k * CROSSING_SETTLE_STEP;
    const f = field(d);
    if (f < bestF - 0.05) {
      best = d;
      bestF = f;
    } else if (f > bestF + 1) break;
  }
  if (!(bestF <= rw)) return "no road at the bank";
  for (const side of [1, -1]) {
    const px = x + ux * best + nx * half * side;
    const pz = z + uz * best + nz * half * side;
    const corner = computeVertexData(px, pz).distanceToRoadCenter;
    if (!(corner <= rw + CROSSING_CORNER_SLACK) || wetAt(px, pz)) return `off the road at the bank (${corner.toFixed(1)}${wetAt(px, pz) ? ", wet" : ""})`;
  }
  const y = computeVertexData(x + ux * best, z + uz * best).height;
  const cont = field(best + rw + 7) < 4 && field(best + rw + 21) < 4 ? 1 : 0;
  return { s: best, y, cont };
};

/** How far the straight line from s0 to s1 along (ux, uz) runs within BRIDGE_ALONG_ALIGN of the
 *  nearest river inside its footprint (alongShoreLength's measure, for a straight deck): a fill slot
 *  at a bend, squared to one leg of the river, can run on along the other leg's bank (a deck mostly
 *  over the sand beside the water). */
const straightAlongShore = (x: number, z: number, ux: number, uz: number, s0: number, s1: number): number => {
  const reach = domainConfig!.river.halfWidth + domainConfig!.river.bank;
  const cosAlign = Math.cos(BRIDGE_ALONG_ALIGN);
  const n = Math.max(1, Math.ceil((s1 - s0) / CROSSING_MARCH));
  const step = (s1 - s0) / n;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const s = s0 + (i + 0.5) * step;
    const w = warp(x + ux * s, z + uz * s);
    riverFieldAt(w.x, w.z);
    if (!(riverSample.distance < reach)) continue;
    riverStraightNear(w.x, w.z);
    if (riverStraight.distance < Infinity && Math.abs(ux * riverStraight.dirX + uz * riverStraight.dirZ) > cosAlign) along += step;
  }
  return along;
};

/** A straight deck through the centerline point (x, z) along (ux, uz), landed on both banks. */
export const straightCrossing = (x: number, z: number, ux: number, uz: number, W: number, street: boolean): { geom: CrossingGeom; cont: number } => {
  const a = landCrossing(x, z, ux, uz, W);
  if (typeof a === "string") return { geom: failedCrossing(a), cont: 0 };
  const b = landCrossing(x, z, -ux, -uz, W);
  if (typeof b === "string") return { geom: failedCrossing(b), cont: 0 };
  if (a.s + b.s > BRIDGE_MAX_LENGTH) return { geom: failedCrossing("too long"), cont: 0 };
  const along = straightAlongShore(x, z, ux, uz, -b.s, a.s);
  if (along > BRIDGE_MAX_ALONG_SHORE) return { geom: failedCrossing(`along the shore for ${Math.round(along)}u`), cont: 0 };
  let path = [
    { x: x - ux * b.s, z: z - uz * b.s },
    { x: x + ux * a.s, z: z + uz * a.s },
  ];
  let ys: [number, number] = [b.y, a.y];
  if (path[0].x > path[1].x || (path[0].x === path[1].x && path[0].z > path[1].z)) {
    path = [path[1], path[0]];
    ys = [a.y, b.y];
  }
  return { geom: { ok: true, why: "", path, ys, x, z, width: W, street }, cont: a.cont + b.cont };
};

/** A crossing's geometry (cached). An arterial's runs along the arterial, turned toward square to
 *  the river until within CROSSING_MAX_SKEW; a fill slot's along its district's street axis nearest
 *  square to the river, on the nearest street line whose street goes on past the quays. */
export const crossingGeom = (c: Crossing): CrossingGeom => {
  if (c.geom) return c.geom;
  const cached = crossingGeoms.get(c.key);
  if (cached) return cached;
  if (crossingGeoms.size > 8192) dropOldestHalf(crossingGeoms);
  const nx = -c.rz;
  const nz = c.rx;
  const cosSkew = Math.cos(CROSSING_MAX_SKEW);
  let g: CrossingGeom;
  if (c.kind === "mouth") {
    g = c.mouths!.length === 2 ? mouthPairGeom(c.mouths![0], c.mouths![1]) : mouthSingleGeom(c.mouths![0]);
  } else if (c.kind === "arterial") {
    let dx = c.tx;
    let dz = c.tz;
    if (dx * nx + dz * nz < 0) {
      dx = -dx;
      dz = -dz;
    }
    if (dx * nx + dz * nz < cosSkew) {
      const a = (Math.sign(nx * dz - nz * dx) || 1) * CROSSING_MAX_SKEW;
      dx = nx * Math.cos(a) - nz * Math.sin(a);
      dz = nx * Math.sin(a) + nz * Math.cos(a);
    }
    // Freeway-wide only where it lands on a freeway at both ends; else a street deck (a freeway-wide
    // end landing on a quay at a slant hangs off the quay's far curb).
    g = straightCrossing(c.x, c.z, dx, dz, deckWidth(), false).geom;
    if (g.ok && !g.path.every((p) => freewayDistanceAt(p.x, p.z) <= domainConfig!.cityConfig.freewayWidth)) g = failedCrossing("not a freeway at both ends");
    if (!g.ok) g = straightCrossing(c.x, c.z, dx, dz, streetDeckWidth(), true).geom;
  } else {
    const gs = domainConfig!.cityConfig.gridSize;
    const d = getCityDistrict(c.x, c.z);
    const axes = [
      { x: d.cos, z: d.sin },
      { x: -d.sin, z: d.cos },
    ];
    const i = Math.abs(axes[0].x * nx + axes[0].z * nz) >= Math.abs(axes[1].x * nx + axes[1].z * nz) ? 0 : 1;
    let ux = nx;
    let uz = nz;
    const options: PointXZ[] = [];
    const along = axes[i].x * nx + axes[i].z * nz;
    if (Math.abs(along) >= cosSkew) {
      ux = axes[i].x * Math.sign(along);
      uz = axes[i].z * Math.sign(along);
      const perp = axes[1 - i];
      // The district-local coordinate across the street lines along the axis (cells are gs squares).
      const rdx = c.x - d.px;
      const rdz = c.z - d.pz;
      const l = i === 0 ? d.pz - rdx * d.sin + rdz * d.cos : d.px + rdx * d.cos + rdz * d.sin;
      const k0 = Math.round(l / gs);
      for (const k of [k0, k0 + 1, k0 - 1].sort((p, q) => Math.abs(p * gs - l) - Math.abs(q * gs - l))) {
        const px = c.x + perp.x * (k * gs - l);
        const pz = c.z + perp.z * (k * gs - l);
        // Back onto the river centerline along the street.
        const t = -((px - c.x) * nx + (pz - c.z) * nz) / (ux * nx + uz * nz);
        const qx = px + ux * t;
        const qz = pz + uz * t;
        if (Math.hypot(qx - c.x, qz - c.z) <= FILL_SNAP_MAX) options.push({ x: qx, z: qz });
      }
    }
    let best: { geom: CrossingGeom; cont: number } | null = null;
    for (const o of options) {
      const r = straightCrossing(o.x, o.z, ux, uz, streetDeckWidth(), true);
      if (!best || (r.geom.ok && (!best.geom.ok || r.cont > best.cont))) best = r;
      if (r.geom.ok && r.cont === 2) break;
    }
    // No street line lands: square across the river from the slot itself.
    if (!best || !best.geom.ok) best = straightCrossing(c.x, c.z, nx, nz, streetDeckWidth(), true);
    g = best.geom;
  }
  crossingGeoms.set(c.key, g);
  return g;
};
