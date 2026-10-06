/**
 * The wall NETWORK — inter-city freeways live ON the biome walls.
 *
 * Built once per biome-grid cell over a WIDE window of sites (NETWORK_RADIUS_CELLS each
 * way) so every decision a central wall depends on is made from the same, complete
 * neighborhood in every window that contains it. FREEWAYS connect city COMPONENTS
 * (adjacent city cells = one city, so one road per pair of neighboring cities, never one
 * per cell pair) by the shortest path over walls with no city and no water on either
 * side. The path starts at a junction on the city's boundary, i.e. a corner of the belt
 * freeway, so it merges into the belt at the wall. Rivers have their own grid and cross
 * roads freely (rivers/riverNetwork.ts); bridges carry the roads over them (bridges/).
 */

import Delaunator from "delaunator";
import type { PointXZ } from "../../math/types";
import { CITY_BIOME_ID } from "../../../world/constants";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { simplex2 } from "../noise";
import type { BiomeContext, VoronoiCell, Zone } from "../types";
import { biomeSiteAt } from "../voronoi";

const NETWORK_RADIUS_CELLS = 18;
/** Sources, runs and hops within this many cells of the window's border are not trusted (see getNetwork). */
const NETWORK_BORDER_CELLS = 3;
/** Every biome cell a vertex lands in needs its network (~10 KB, ~20 ms to build), and the terrain
 *  worker's LOD rings alone touch ~720 cells around a spawn. */
const NETWORK_CACHE_MAX = 1024;
/** Freeways combine their segments by a smooth minimum (real units) and are measured from a
 *  gently meandered query point: a road may wind, not wobble. */
export const FREEWAY_SMIN_K = 14;
const FREEWAY_MEANDER_AMP = 3;
const FREEWAY_MEANDER_SCALE = 160;
/** City components at most this many cells apart get a freeway between them. */
export const FREEWAY_LINK_CELLS = 4;
/** A path longer than this × the straight distance between the two cities is a detour (the
 *  pair relays through whatever lies between) and is dropped. */
const FREEWAY_PATH_MAX_STRETCH = 1.7;
/** Gap hops: chains of at most this many walkable walls / this long between the boundaries of two
 *  different city cells become freeways too (the short grass gaps between lobes of a city). */
const FREEWAY_GAP_WALLS = 2;
const FREEWAY_GAP_LENGTH = 450;

interface NetSite {
  x: number;
  z: number;
  ix: number;
  iz: number;
  zone: Zone;
}
interface NetJunction {
  x: number;
  z: number;
  sites: [number, number, number];
  city: boolean;
  comp: number;
  walls: number[];
}
interface NetWall {
  s: number;
  e: number;
  a: number;
  b: number;
  len: number;
}

/** A freeway path along walls: warped-space polyline + cumulative arc length. */
export interface FreewayRun {
  pts: number[]; // x, z pairs
  cum: number[]; // cumulative length at each point
  length: number;
  /** Dash-phase offset so two runs never share a phase origin. */
  phase: number;
  /** Bounding box of pts (nearestFreewayRun's skip test). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WallNetwork {
  freeways: FreewayRun[];
  /** Routing diagnostics (tests/probes). */
  debug: { comps: number; pairs: number; linked: number; noPath: number; stretched: number; gaps: number };
}

const networkCache = new Map<string, WallNetwork>();

type NetworkDebug = WallNetwork["debug"];

/** A network window's site graph: sites, junctions (Delaunay triangles, at their circumcenters) and
 *  walls (Delaunay edges between two triangles), with each junction's city component. */
interface NetGraph {
  sites: NetSite[];
  junctions: NetJunction[];
  walls: NetWall[];
  /** The city component (union-find root over city|city walls) of a site. */
  compOf: (site: number) => number;
  /** 1 where a freeway may run: no city, no water and no prohibitRoads biome on either side. */
  walkable: Uint8Array;
  /** Well inside the window. The Delaunay is distorted along the window's border, so a source or a
   *  run there decides differently than the window that has it near its center (roads would end at
   *  cell borders). */
  trusted: (x: number, z: number) => boolean;
}

const buildNetGraph = (cx: number, cz: number): NetGraph => {
  const gs = domainConfig!.gridSize;
  const R = NETWORK_RADIUS_CELLS;

  // Sites over the wide window, each zoned by its OWN region grid (biomeSiteAt): the window center's
  // 5×5 region grid ends ~6000u out, inside the window's 9000u reach.
  const sites: NetSite[] = [];
  for (let ix = cx - R; ix <= cx + R; ix++) {
    for (let iz = cz - R; iz <= cz + R; iz++) {
      const site = biomeSiteAt(ix, iz);
      sites.push({ x: site.x, z: site.z, ix, iz, zone: site.zone });
    }
  }
  const coords = new Float64Array(sites.length * 2);
  for (let i = 0; i < sites.length; i++) {
    coords[i * 2] = sites[i].x;
    coords[i * 2 + 1] = sites[i].z;
  }
  const delaunay = new Delaunator(coords);
  const tri = delaunay.triangles;

  const junctions: NetJunction[] = [];
  for (let t = 0; t < tri.length / 3; t++) {
    const A = sites[tri[t * 3]];
    const B = sites[tri[t * 3 + 1]];
    const C = sites[tri[t * 3 + 2]];
    const ad = A.x * A.x + A.z * A.z;
    const bd = B.x * B.x + B.z * B.z;
    const cd = C.x * C.x + C.z * C.z;
    const D = 2 * (A.x * (B.z - C.z) + B.x * (C.z - A.z) + C.x * (A.z - B.z));
    const jx = (ad * (B.z - C.z) + bd * (C.z - A.z) + cd * (A.z - B.z)) / D;
    const jz = (ad * (C.x - B.x) + bd * (A.x - C.x) + cd * (B.x - A.x)) / D;
    const zs = [A.zone, B.zone, C.zone];
    junctions.push({
      x: jx,
      z: jz,
      sites: [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]],
      city: zs.some((z) => z.biome.id === CITY_BIOME_ID),
      comp: -1,
      walls: [],
    });
  }

  const parent = sites.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const walls: NetWall[] = [];
  const half = delaunay.halfedges;
  for (let e = 0; e < half.length; e++) {
    const o = half[e];
    if (o === -1 || o < e) continue;
    const a = tri[e];
    const b = tri[e % 3 === 2 ? e - 2 : e + 1];
    const za = sites[a].zone;
    const zb = sites[b].zone;
    if (za.biome.id === CITY_BIOME_ID && zb.biome.id === CITY_BIOME_ID) {
      parent[find(a)] = find(b);
    }
    const s = Math.floor(e / 3);
    const t = Math.floor(o / 3);
    const wi = walls.length;
    walls.push({ s, e: t, a, b, len: Math.hypot(junctions[s].x - junctions[t].x, junctions[s].z - junctions[t].z) });
    junctions[s].walls.push(wi);
    junctions[t].walls.push(wi);
  }
  for (const j of junctions) {
    for (const si of j.sites) {
      if (sites[si].zone.biome.id === CITY_BIOME_ID) {
        j.comp = find(si);
        break;
      }
    }
  }

  // Per network, not per pair (per pair it was half of a network build).
  const walkable = new Uint8Array(walls.length);
  for (let wi = 0; wi < walls.length; wi++) {
    const za = sites[walls[wi].a].zone;
    const zb = sites[walls[wi].b].zone;
    walkable[wi] =
      za.biome.id === CITY_BIOME_ID || zb.biome.id === CITY_BIOME_ID || za.biome.water || zb.biome.water || za.biome.prohibitRoads || zb.biome.prohibitRoads
        ? 0
        : 1;
  }

  const cellsFromCenter = (x: number, z: number) => Math.max(Math.abs(x / gs - (cx + 0.5)), Math.abs(z / gs - (cz + 0.5)));
  const trusted = (x: number, z: number) => cellsFromCenter(x, z) <= R - NETWORK_BORDER_CELLS;
  return { sites, junctions, walls, compOf: find, walkable, trusted };
};

/** (1) City components within FREEWAY_LINK_CELLS: one shortest path per pair (binary-heap
 *  Dijkstra; deterministic tie-break by junction position). Every pair the window can route
 *  is routed (routed only from windows centered near it, roads would end at cell borders), but
 *  only paths that stay in the trusted interior are kept. */
const routeCityPairs = (g: NetGraph, freewayWalls: Set<number>, debug: NetworkDebug): void => {
  const { sites, junctions, walls, walkable, trusted } = g;
  const compCells = new Map<number, NetSite[]>();
  for (let si = 0; si < sites.length; si++) {
    const s = sites[si];
    if (s.zone.biome.id !== CITY_BIOME_ID) continue;
    const c = g.compOf(si);
    let list = compCells.get(c);
    if (!list) compCells.set(c, (list = []));
    list.push(s);
  }
  const comps = [...compCells.keys()].sort((p, q) => p - q);
  debug.comps = comps.length;
  // Each city's cell-index box: two cities whose boxes lie more than FREEWAY_LINK_CELLS apart have no
  // pair of cells that close, so the pair is skipped without comparing its cells.
  const boxes = comps.map((c) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const a of compCells.get(c)!) {
      box[0] = Math.min(box[0], a.ix);
      box[1] = Math.min(box[1], a.iz);
      box[2] = Math.max(box[2], a.ix);
      box[3] = Math.max(box[3], a.iz);
    }
    return box;
  });
  const compJunctions = new Map<number, number[]>();
  for (let i = 0; i < junctions.length; i++) {
    const c = junctions[i].comp;
    if (c === -1) continue;
    let list = compJunctions.get(c);
    if (!list) compJunctions.set(c, (list = []));
    list.push(i);
  }
  // A path is kept only if every junction on it is trusted, its two ends included: a pair with a city
  // that has no trusted junction is not searched (the path it found would be dropped).
  const routable = new Set<number>();
  for (const [c, list] of compJunctions) if (list.some((i) => trusted(junctions[i].x, junctions[i].z))) routable.add(c);
  // The search's hot fields as flat arrays (the same values, read without object hops).
  const jx = new Float64Array(junctions.length);
  const jz = new Float64Array(junctions.length);
  const jcomp = new Int32Array(junctions.length);
  for (let i = 0; i < junctions.length; i++) {
    jx[i] = junctions[i].x;
    jz[i] = junctions[i].z;
    jcomp[i] = junctions[i].comp;
  }
  const wallS = new Int32Array(walls.length);
  const wallE = new Int32Array(walls.length);
  const wallLen = new Float64Array(walls.length);
  for (let wi = 0; wi < walls.length; wi++) {
    wallS[wi] = walls[wi].s;
    wallE[wi] = walls[wi].e;
    wallLen[wi] = walls[wi].len;
  }
  // Whether a pair HAS a path is a property of the graph, not of the search order: from P's junctions a
  // search moves over walkable walls through non-city junctions only, to one of Q's. So the components of
  // non-city junctions joined by walkable walls answer "no path" without the search, which explored
  // everything reachable before giving up.
  const freeRoot = new Int32Array(junctions.length);
  for (let i = 0; i < junctions.length; i++) freeRoot[i] = i;
  const freeFind = (i: number): number => {
    while (freeRoot[i] !== i) i = freeRoot[i] = freeRoot[freeRoot[i]];
    return i;
  };
  for (let wi = 0; wi < walls.length; wi++) {
    if (walkable[wi] && jcomp[wallS[wi]] === -1 && jcomp[wallE[wi]] === -1) freeRoot[freeFind(wallS[wi])] = freeFind(wallE[wi]);
  }
  const touchesFree = new Map<number, Set<number>>();
  const touchesCity = new Map<number, Set<number>>();
  const touch = (m: Map<number, Set<number>>, c: number, v: number) => {
    let set = m.get(c);
    if (!set) m.set(c, (set = new Set()));
    set.add(v);
  };
  for (let wi = 0; wi < walls.length; wi++) {
    if (!walkable[wi]) continue;
    const cs = jcomp[wallS[wi]];
    const ce = jcomp[wallE[wi]];
    if (cs !== -1 && ce === -1) touch(touchesFree, cs, freeFind(wallE[wi]));
    else if (ce !== -1 && cs === -1) touch(touchesFree, ce, freeFind(wallS[wi]));
    else if (cs !== -1 && ce !== -1 && cs !== ce) {
      touch(touchesCity, cs, ce);
      touch(touchesCity, ce, cs);
    }
  }
  const pathExists = (P: number, Q: number): boolean => {
    if (touchesCity.get(P)?.has(Q)) return true;
    const fp = touchesFree.get(P);
    const fq = touchesFree.get(Q);
    if (!fp || !fq) return false;
    for (const r of fp) if (fq.has(r)) return true;
    return false;
  };
  const heap: number[] = [];
  const dist = new Float64Array(junctions.length);
  const prev = new Int32Array(junctions.length);
  // The wall each junction was last reached over (always the one wall between it and prev).
  const prevWall = new Int32Array(junctions.length);
  // dist/done hold for the current pair only where stamped with its epoch.
  const reached = new Int32Array(junctions.length);
  const doneAt = new Int32Array(junctions.length);
  let epoch = 0;
  const less = (a: number, b: number) => dist[a] < dist[b] || (dist[a] === dist[b] && (jx[a] < jx[b] || (jx[a] === jx[b] && jz[a] < jz[b])));
  const push = (v: number) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const parentI = (i - 1) >> 1;
      if (!less(heap[i], heap[parentI])) break;
      const t = heap[i];
      heap[i] = heap[parentI];
      heap[parentI] = t;
      i = parentI;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        const t = heap[i];
        heap[i] = heap[m];
        heap[m] = t;
        i = m;
      }
    }
    return top;
  };
  for (let pi = 0; pi < comps.length; pi++) {
    for (let qi = pi + 1; qi < comps.length; qi++) {
      const P = comps[pi];
      const Q = comps[qi];
      const bp = boxes[pi];
      const bq = boxes[qi];
      if (Math.max(bq[0] - bp[2], bp[0] - bq[2], bq[1] - bp[3], bp[1] - bq[3]) > FREEWAY_LINK_CELLS) {
        debug.pairs++;
        continue;
      }
      const pc = compCells.get(P)!;
      const qc = compCells.get(Q)!;
      let best = Infinity;
      let straight = Infinity;
      for (const a of pc) {
        for (const b of qc) {
          const d = Math.max(Math.abs(a.ix - b.ix), Math.abs(a.iz - b.iz));
          if (d < best) best = d;
          const sd = Math.hypot(a.x - b.x, a.z - b.z);
          if (sd < straight) straight = sd;
        }
      }
      debug.pairs++;
      if (best > FREEWAY_LINK_CELLS) continue;
      debug.linked++;
      if (!pathExists(P, Q)) {
        debug.noPath++;
        continue;
      }
      if (!routable.has(P) || !routable.has(Q)) continue;
      epoch++;
      heap.length = 0;
      for (const i of compJunctions.get(P) ?? []) {
        dist[i] = 0;
        prev[i] = -1;
        reached[i] = epoch;
        push(i);
      }
      let target = -1;
      while (heap.length > 0) {
        const u = pop();
        if (doneAt[u] === epoch) continue;
        doneAt[u] = epoch;
        if (jcomp[u] === Q) {
          target = u;
          break;
        }
        const uWalls = junctions[u].walls;
        for (let k = 0; k < uWalls.length; k++) {
          const wi = uWalls[k];
          if (!walkable[wi]) continue;
          const v = wallS[wi] === u ? wallE[wi] : wallS[wi];
          if (doneAt[v] === epoch) continue;
          const cv = jcomp[v];
          if (cv !== -1 && cv !== P && cv !== Q) continue; // a third city: relay
          if (cv === P) continue; // never back along the start city's boundary
          const nd = dist[u] + wallLen[wi];
          if (reached[v] !== epoch || nd < dist[v]) {
            dist[v] = nd;
            prev[v] = u;
            prevWall[v] = wi;
            reached[v] = epoch;
            push(v);
          }
        }
      }
      if (target < 0) {
        debug.noPath++;
        continue;
      }
      const chain: number[] = [];
      let length = 0;
      let inside = true;
      for (let u = target; prev[u] !== -1; u = prev[u]) {
        const wi = prevWall[u];
        chain.push(wi);
        length += walls[wi].len;
        if (!trusted(junctions[u].x, junctions[u].z) || !trusted(junctions[prev[u]].x, junctions[prev[u]].z)) inside = false;
      }
      if (!inside) continue;
      if (length > FREEWAY_PATH_MAX_STRETCH * straight || length < 1) {
        debug.stretched++;
        continue;
      }
      for (const wi of chain) freewayWalls.add(wi);
    }
  }
};

/** (2) Gap hops: from every city-boundary junction, walkable chains of ≤ FREEWAY_GAP_WALLS walls
 *  (≤ FREEWAY_GAP_LENGTH long) that end on a junction of a DIFFERENT city cell, with no city
 *  junction in between — the short grass gaps between two lobes of the same or another city. */
const addGapHops = (g: NetGraph, freewayWalls: Set<number>, debug: NetworkDebug): void => {
  const { sites, junctions, walls, walkable, trusted } = g;
  const citySitesOf = (j: NetJunction): number[] => j.sites.filter((si) => sites[si].zone.biome.id === CITY_BIOME_ID);
  for (let ji = 0; ji < junctions.length; ji++) {
    const j0 = junctions[ji];
    if (!j0.city || !trusted(j0.x, j0.z)) continue;
    const own = citySitesOf(j0);
    const hop = (u: number, chain: number[], length: number): void => {
      for (const wi of junctions[u].walls) {
        const w = walls[wi];
        if (!walkable[wi] || chain.includes(wi)) continue;
        const v = w.s === u ? w.e : w.s;
        const total = length + w.len;
        if (total > FREEWAY_GAP_LENGTH) continue;
        const jv = junctions[v];
        if (jv.city) {
          if (v !== ji && trusted(jv.x, jv.z) && citySitesOf(jv).every((si) => !own.includes(si))) {
            for (const c of chain) freewayWalls.add(c);
            freewayWalls.add(wi);
            debug.gaps++;
          }
          continue; // a city junction ends every chain
        }
        if (chain.length + 1 < FREEWAY_GAP_WALLS) hop(v, [...chain, wi], total);
      }
    };
    hop(ji, [], 0);
  }
};

/** (3) Polylines: the wall set walked from its ends and hubs (degree ≠ 2), then any leftover cycles. */
const walkFreewayRuns = (g: NetGraph, freewayWalls: Set<number>): FreewayRun[] => {
  const { junctions, walls } = g;
  const degree = new Map<number, number[]>();
  for (const wi of freewayWalls) {
    const w = walls[wi];
    for (const j of [w.s, w.e]) {
      let l = degree.get(j);
      if (!l) degree.set(j, (l = []));
      l.push(wi);
    }
  }
  const usedWall = new Set<number>();
  const freeways: FreewayRun[] = [];
  const walk = (start: number, firstWall: number): void => {
    const pts = [junctions[start].x, junctions[start].z];
    const cum = [0];
    let u = start;
    let wi = firstWall;
    for (;;) {
      usedWall.add(wi);
      const w = walls[wi];
      const v = w.s === u ? w.e : w.s;
      pts.push(junctions[v].x, junctions[v].z);
      cum.push(cum[cum.length - 1] + w.len);
      const next = degree.get(v)!;
      if (next.length !== 2 || v === start) break;
      const nw = next[0] === wi ? next[1] : next[0];
      if (usedWall.has(nw)) break;
      u = v;
      wi = nw;
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      minX = Math.min(minX, pts[k]);
      maxX = Math.max(maxX, pts[k]);
      minZ = Math.min(minZ, pts[k + 1]);
      maxZ = Math.max(maxZ, pts[k + 1]);
    }
    freeways.push({ pts, cum, length: cum[cum.length - 1], phase: pts[0] + pts[1], minX, minZ, maxX, maxZ });
  };
  const hubs = [...degree.entries()].filter(([, l]) => l.length !== 2).map(([j]) => j).sort((p, q) => junctions[p].x - junctions[q].x || junctions[p].z - junctions[q].z);
  for (const j of hubs) for (const wi of degree.get(j)!) if (!usedWall.has(wi)) walk(j, wi);
  for (const wi of [...freewayWalls].sort((p, q) => p - q)) if (!usedWall.has(wi)) walk(walls[wi].s, wi);
  return freeways;
};

/** The freeway network of a warped point's biome-grid cell, cached per cell. Freeways are a SET of
 *  walls — shortest paths between neighboring cities plus every short chain that hops a gap
 *  between two city lobes — then polylines walked out of it. Roads are NOT routed around rivers
 *  (two windows would disagree on the road's path and it would end at a cell border): decks carry them. */
export const getNetwork = (warped: PointXZ): WallNetwork => {
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(warped.x / gs);
  const cz = Math.floor(warped.z / gs);
  const cacheKey = `${cx},${cz}`;
  const cached = networkCache.get(cacheKey);
  if (cached) return cached;
  if (networkCache.size >= NETWORK_CACHE_MAX) dropOldestHalf(networkCache);

  const graph = buildNetGraph(cx, cz);
  const freewayWalls = new Set<number>();
  const debug: NetworkDebug = { comps: 0, pairs: 0, linked: 0, noPath: 0, stretched: 0, gaps: 0 };
  routeCityPairs(graph, freewayWalls, debug);
  addGapHops(graph, freewayWalls, debug);
  const network: WallNetwork = { freeways: walkFreewayRuns(graph, freewayWalls), debug };
  networkCache.set(cacheKey, network);
  return network;
};

const networkByGrid = new WeakMap<VoronoiCell[], WallNetwork>();

/** The freeway network of a context's biome cell (the grid's cell), memoized on grid identity and
 *  built only when something asks: most contexts — river surfaces, sky polls, zone lookups — never
 *  need it, and a network build is ~5–20 ms. */
export const networkOf = (ctx: BiomeContext): WallNetwork => {
  let network = networkByGrid.get(ctx.grid);
  if (!network) {
    network = getNetwork(ctx.warped);
    networkByGrid.set(ctx.grid, network);
  }
  return network;
};

/** Polynomial smooth minimum (Inigo Quilez): min(a, b) with the crease within k rounded off. */
export const smoothMin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** The gently meandered point a freeway distance is measured from (written by meanderFreewayQuery). */
const meanderedQuery = { x: 0, z: 0 };
const meanderFreewayQuery = (px0: number, pz0: number): void => {
  meanderedQuery.x = px0 + FREEWAY_MEANDER_AMP * simplex2(px0 / FREEWAY_MEANDER_SCALE, pz0 / FREEWAY_MEANDER_SCALE);
  meanderedQuery.z = pz0 + FREEWAY_MEANDER_AMP * simplex2(pz0 / FREEWAY_MEANDER_SCALE + 5.7, px0 / FREEWAY_MEANDER_SCALE - 2.3);
};

/** What the last nearestFreewayRun found: the smooth-min distance to the runs (warped, real
 *  units; Infinity when there are none), and the dash phase and closest point of the nearest one. */
export const nearestRun = { distance: Infinity, along: 0, x: 0, z: 0 };

export const nearestFreewayRun = (px0: number, pz0: number, runs: FreewayRun[]): void => {
  nearestRun.distance = Infinity;
  if (runs.length === 0) return;
  // A gentle meander, and a smooth minimum over the segments: rounded bends and hubs.
  meanderFreewayQuery(px0, pz0);
  const px = meanderedQuery.x;
  const pz = meanderedQuery.z;
  let best = Infinity;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    // A run whose box lies FREEWAY_SMIN_K beyond the running smooth minimum changes neither it
    // (smoothMin is the exact min there) nor the argmin, so skipping it is exact (+1e-6: rounding).
    const bx = Math.max(run.minX - px, 0, px - run.maxX);
    const bz = Math.max(run.minZ - pz, 0, pz - run.maxZ);
    const lim = nearestRun.distance + FREEWAY_SMIN_K + 1e-6;
    if (lim > 0 && bx * bx + bz * bz > lim * lim) continue;
    const pts = run.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const sx = pts[i];
      const sz = pts[i + 1];
      const dx = pts[i + 2] - sx;
      const dz = pts[i + 3] - sz;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((px - sx) * dx + (pz - sz) * dz) / lenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = sx + dx * t;
      const cz = sz + dz * t;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < best) {
        best = d;
        nearestRun.along = run.cum[i / 2] + t * Math.sqrt(lenSq) + run.phase;
        nearestRun.x = cx;
        nearestRun.z = cz;
      }
      nearestRun.distance = smoothMin(nearestRun.distance, d, FREEWAY_SMIN_K);
    }
  }
};

/** Every run segment within `reach` of (px0, pz0) — measured from the same meandered point as
 *  nearestFreewayRun — with its nearest point, that point's arc along its run, the projection's t and
 *  the segment's ends: what a road's GRADE blends over (computeVertexData; it drops the redundant
 *  ones). Written into segCandidates. */
export const segCandidates = {
  n: 0,
  run: [] as (FreewayRun | null)[],
  along: [] as number[],
  d: [] as number[],
  x: [] as number[],
  z: [] as number[],
  t: [] as number[],
  seg: [] as number[],
};
export const pushSegCandidate = (run: FreewayRun | null, along: number, d: number, x: number, z: number, t: number, sx: number, sz: number, ex: number, ez: number): void => {
  const k = segCandidates.n++;
  segCandidates.run[k] = run;
  segCandidates.along[k] = along;
  segCandidates.d[k] = d;
  segCandidates.x[k] = x;
  segCandidates.z[k] = z;
  segCandidates.t[k] = t;
  segCandidates.seg[k * 4] = sx;
  segCandidates.seg[k * 4 + 1] = sz;
  segCandidates.seg[k * 4 + 2] = ex;
  segCandidates.seg[k * 4 + 3] = ez;
};
export const collectRunCandidates = (px0: number, pz0: number, runs: FreewayRun[], reach: number): void => {
  if (runs.length === 0) return;
  meanderFreewayQuery(px0, pz0);
  const px = meanderedQuery.x;
  const pz = meanderedQuery.z;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const bx = Math.max(run.minX - px, 0, px - run.maxX);
    const bz = Math.max(run.minZ - pz, 0, pz - run.maxZ);
    if (bx * bx + bz * bz > reach * reach) continue;
    const pts = run.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const sx = pts[i];
      const sz = pts[i + 1];
      const dx = pts[i + 2] - sx;
      const dz = pts[i + 3] - sz;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((px - sx) * dx + (pz - sz) * dz) / lenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = sx + dx * t;
      const cz = sz + dz * t;
      const d = Math.hypot(px - cx, pz - cz);
      if (d > reach) continue;
      pushSegCandidate(run, run.cum[i / 2] + t * Math.sqrt(lenSq), d, cx, cz, t, sx, sz, pts[i + 2], pts[i + 3]);
    }
  }
};

/** Point at arc-length `s` along a run (warped space). */
export const freewayPointAt = (run: { pts: number[]; cum: number[] }, s: number): PointXZ => {
  const pts = run.pts;
  const cum = run.cum;
  if (s <= 0) return { x: pts[0], z: pts[1] };
  for (let i = 1; i < cum.length; i++) {
    if (s <= cum[i]) {
      const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return { x: pts[(i - 1) * 2] + (pts[i * 2] - pts[(i - 1) * 2]) * t, z: pts[(i - 1) * 2 + 1] + (pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]) * t };
    }
  }
  return { x: pts[pts.length - 2], z: pts[pts.length - 1] };
};

export const clearNetworkCache = (): void => networkCache.clear();
