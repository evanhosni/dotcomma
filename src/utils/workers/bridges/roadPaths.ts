/** Step 1: every road near a river as a RoadPath — samples on a canonical lattice (each wall or leg
 *  from its lexicographically smaller end, the arterials on a global coordinate lattice), so every
 *  chunk samples a road identically. */

import { CITY_BIOME_ID } from "../../../world/constants";
import { distanceToSegment } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { CITY_WIGGLE_AMP, cityDistrictPitch, cityRowBoundary, cityRowEdgeZ, citySegBoundary, citySegEdgeX, findCityRow, findCitySeg, wallDrownedAt } from "../roads/cityTerrain";
import { domainConfig } from "../computeConfig";
import { getNetwork } from "../roads/freewayNetwork";
import { unwarp, warp } from "../noise";
import { riverFieldAt, riverSample, riverStraight, riverStraightNear } from "../rivers/riverField";
import { RIVER_MEANDER_AMP, type RiverEdge, type RiverPiece } from "../rivers/riverNetwork";
import { getBiomeGrid, getZoneWalls, isCanonicalWall, zoneAtWarped } from "../voronoi";
import { BRIDGE_ROAD_MARGIN, BRIDGE_WET_SAMPLE, warpMax } from "./constants";
import { mergeIntervals, segSegDistance } from "./polyline";
import type { BridgeWindow, RoadPath, WindowScan } from "./types";

const newPath = (kind: RoadPath["kind"]): RoadPath => ({ kind, wx: [], wz: [], x: [], z: [] });

const boxMeetsWindow = (ax: number, az: number, bx: number, bz: number, w: BridgeWindow): boolean =>
  Math.max(ax, bx) >= w.x0 && Math.min(ax, bx) <= w.x1 && Math.max(az, bz) >= w.z0 && Math.min(az, bz) <= w.z1;

/** A path's samples inside the window, split into paths wherever it leaves (its ends near the
 *  edge are the guard's business). */
const clipPath = (path: RoadPath, w: BridgeWindow, out: RoadPath[]): void => {
  let part: RoadPath | null = null;
  const flush = () => {
    if (part && part.wx.length > 1) out.push(part);
    part = null;
  };
  for (let i = 0; i < path.wx.length; i++) {
    const px = path.wx[i];
    const pz = path.wz[i];
    if (px < w.x0 || px > w.x1 || pz < w.z0 || pz > w.z1) {
      flush();
      continue;
    }
    if (!part) part = newPath(path.kind);
    part.wx.push(px);
    part.wz.push(pz);
    part.x.push(path.x[i]);
    part.z.push(path.z[i]);
  }
  flush();
};
const pushWarped = (path: RoadPath, wx: number, wz: number): void => {
  const p = unwarp(wx, wz);
  path.wx.push(wx);
  path.wz.push(wz);
  path.x.push(p.x);
  path.z.push(p.z);
};
const pushWorld = (path: RoadPath, x: number, z: number): void => {
  const w = warp(x, z);
  path.wx.push(w.x);
  path.wz.push(w.z);
  path.x.push(x);
  path.z.push(z);
};

/** Samples of a straight warped leg a→b on its canonical lattice (from its lexicographically
 *  smaller end, so either walking direction lands on the same points), `a` excluded. */
const pushLeg = (path: RoadPath, ax: number, az: number, bx: number, bz: number): void => {
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / BRIDGE_WET_SAMPLE));
  const forward = ax < bx || (ax === bx && az <= bz);
  const [ox, oz, qx, qz] = forward ? [ax, az, bx, bz] : [bx, bz, ax, az];
  for (let i = 1; i <= n; i++) {
    const k = forward ? i : n - i;
    if (!forward && i === n) pushWarped(path, bx, bz);
    else pushWarped(path, ox + (qx - ox) * (k / n), oz + (qz - oz) * (k / n));
  }
};

/** Chains straight warped legs (walls) that share endpoints into paths, clipped to the window; a
 *  closed loop is opened at its node farthest from the rivers, so both of its ends are dry. Every
 *  choice is canonical (open chains from their lexicographically smaller end, a loop's seam by the
 *  river field with a positional tie-break), never by the order the legs were found in. */
const chainLegs = (legs: number[][], kind: RoadPath["kind"], w: BridgeWindow, out: RoadPath[]): void => {
  const less = (ax: number, az: number, bx: number, bz: number) => ax < bx || (ax === bx && az < bz);
  const dryness = (x: number, z: number): number => {
    if (seamDryness) return seamDryness(x, z);
    riverFieldAt(x, z);
    return Math.min(riverSample.distance, 1e9);
  };
  const nodeKey = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
  const at = new Map<string, number[]>();
  legs.forEach((l, i) => {
    for (const k of [nodeKey(l[0], l[1]), nodeKey(l[2], l[3])]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(legs.length);
  const walk = (startLeg: number, fromStart: boolean): number[] => {
    const pts: number[] = [];
    let li = startLeg;
    let fwd = fromStart;
    for (;;) {
      used[li] = 1;
      const l = legs[li];
      const [ax, az, bx, bz] = fwd ? l : [l[2], l[3], l[0], l[1]];
      if (pts.length === 0) pts.push(ax, az);
      pts.push(bx, bz);
      const next = (at.get(nodeKey(bx, bz)) ?? []).filter((j) => !used[j]);
      if (next.length !== 1 || (at.get(nodeKey(bx, bz)) ?? []).length !== 2) break;
      li = next[0];
      fwd = nodeKey(legs[li][0], legs[li][1]) === nodeKey(bx, bz);
    }
    return pts;
  };
  const reversed = (pts: number[]): number[] => {
    const r: number[] = [];
    for (let k = pts.length - 2; k >= 0; k -= 2) r.push(pts[k], pts[k + 1]);
    return r;
  };
  const chains: number[][] = [];
  for (let i = 0; i < legs.length; i++) {
    if (used[i]) continue;
    const ka = nodeKey(legs[i][0], legs[i][1]);
    const kb = nodeKey(legs[i][2], legs[i][3]);
    let pts: number[] | null = null;
    if ((at.get(ka) ?? []).length !== 2) pts = walk(i, true);
    else if ((at.get(kb) ?? []).length !== 2) pts = walk(i, false);
    if (!pts) continue;
    const n = pts.length;
    chains.push(less(pts[n - 2], pts[n - 1], pts[0], pts[1]) ? reversed(pts) : pts);
  }
  for (let i = 0; i < legs.length; i++) {
    if (used[i]) continue;
    // A closed loop: walk it, then rotate its start to its driest node.
    const loop = walk(i, true);
    const body = loop.slice(0, loop.length - 2);
    let best = 0;
    let bestDry = -Infinity;
    for (let k = 0; k < body.length; k += 2) {
      const d = dryness(body[k], body[k + 1]);
      if (d > bestDry || (d === bestDry && less(body[k], body[k + 1], body[best], body[best + 1]))) {
        bestDry = d;
        best = k;
      }
    }
    let ring = [...body.slice(best), ...body.slice(0, best)];
    // Walk it toward the smaller of the seam's two neighbors.
    const m = ring.length;
    if (m >= 6 && less(ring[m - 2], ring[m - 1], ring[2], ring[3])) ring = [ring[0], ring[1], ...reversed(ring.slice(2))];
    chains.push([...ring, ring[0], ring[1]]);
  }
  for (const pts of chains) {
    const path = newPath(kind);
    pushWarped(path, pts[0], pts[1]);
    for (let k = 0; k + 3 < pts.length; k += 2) pushLeg(path, pts[k], pts[k + 1], pts[k + 2], pts[k + 3]);
    clipPath(path, w, out);
  }
};

/** The belt: city walls (city on exactly one side) near the rivers, each taken from the biome
 *  cell holding its midpoint — a window's outer walls sit where its Delaunay is distorted. */
const collectBeltPaths = (cells: Iterable<[number, number]>, nearRivers: (ax: number, az: number, bx: number, bz: number) => boolean, w: BridgeWindow, out: RoadPath[]): boolean => {
  const gs = domainConfig!.gridSize;
  const legs: number[][] = [];
  for (const [cx, cz] of cells) {
    const center = { x: (cx + 0.5) * gs, z: (cz + 0.5) * gs };
    const walls = getZoneWalls(center, getBiomeGrid(center));
    for (const w of walls) {
      if ((w.a.biome.id === CITY_BIOME_ID) === (w.b.biome.id === CITY_BIOME_ID)) continue;
      if (!isCanonicalWall(w)) continue;
      if (Math.floor((w.sx + w.ex) / 2 / gs) !== cx || Math.floor((w.sz + w.ez) / 2 / gs) !== cz) continue;
      if (!nearRivers(w.sx, w.sz, w.ex, w.ez)) continue;
      legs.push([w.sx, w.sz, w.ex, w.ez]);
    }
  }
  chainLegs(legs, "belt", w, out);
  return legs.length > 0;
};

/** Samples one world-space curve (x(u), z(u) on a global u-lattice over [u0, u1], exact ends)
 *  into paths, keeping only the in-city stretches; each city exit is bisected onto the wall. */
const sampleCityCurve = (kind: RoadPath["kind"], u0: number, u1: number, at: (u: number) => PointXZ, out: RoadPath[]): void => {
  if (u1 - u0 < 1e-6) return;
  const inCity = (u: number) => {
    const p = at(u);
    const w = warp(p.x, p.z);
    return zoneAtWarped(w.x, w.z).biome.id === CITY_BIOME_ID;
  };
  const us: number[] = [u0];
  for (let u = Math.ceil(u0 / BRIDGE_WET_SAMPLE) * BRIDGE_WET_SAMPLE; u < u1; u += BRIDGE_WET_SAMPLE) if (u > u0) us.push(u);
  us.push(u1);
  let path: RoadPath | null = null;
  let prevU = u0;
  let prevIn = false;
  const bisect = (inside: number, outside: number): number => {
    for (let it = 0; it < 14; it++) {
      const m = (inside + outside) / 2;
      if (inCity(m)) inside = m;
      else outside = m;
    }
    return inside;
  };
  for (let i = 0; i < us.length; i++) {
    const u = us[i];
    const inside = inCity(u);
    if (inside && !path) {
      path = newPath(kind);
      if (i > 0 && !prevIn) {
        const b = at(bisect(u, prevU));
        pushWorld(path, b.x, b.z);
      }
    }
    if (inside && path) {
      const p = at(u);
      pushWorld(path, p.x, p.z);
    }
    if (!inside && path) {
      const b = at(bisect(prevU, u));
      pushWorld(path, b.x, b.z);
      if (path.wx.length > 1) out.push(path);
      path = null;
    }
    prevU = u;
    prevIn = inside;
  }
  if (path && path.wx.length > 1) out.push(path);
};

/** The city arterials near the rivers (world boxes): row boundaries across the window, segment
 *  boundaries between their rows, ending EXACTLY on their row's edge. Only in-city samples count. */
const collectArterialPaths = (minX: number, minZ: number, maxX: number, maxZ: number, boxes: number[][], out: RoadPath[]): void => {
  const pitch = cityDistrictPitch();
  const wig = CITY_WIGGLE_AMP;
  for (let k = Math.floor(minZ / pitch) - 1; k <= Math.floor(maxZ / pitch) + 2; k++) {
    const base = cityRowBoundary(k);
    if (base < minZ - wig || base > maxZ + wig) continue;
    const spans = mergeIntervals(boxes.filter((b) => b[1] <= base + wig && b[3] >= base - wig).map((b) => [Math.max(minX, b[0]), Math.min(maxX, b[2])]));
    for (const [x0, x1] of spans) sampleCityCurve("arterial", x0, x1, (x) => ({ x, z: cityRowEdgeZ(k, x) }), out);
  }
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  for (let r = findCityRow(minZ, midX) - 1; r <= findCityRow(maxZ, midX) + 1; r++) {
    for (let m = findCitySeg(r, minX, midZ) - 1; m <= findCitySeg(r, maxX, midZ) + 2; m++) {
      const base = citySegBoundary(r, m);
      if (base < minX - wig || base > maxX + wig) continue;
      // Where the segment curve meets its row edges (fixed point: the wiggles are gentle).
      const meet = (row: number): number => {
        let z = cityRowBoundary(row);
        for (let it = 0; it < 8; it++) z = cityRowEdgeZ(row, citySegEdgeX(r, m, z));
        return z;
      };
      const zLo = meet(r);
      const zHi = meet(r + 1);
      const spans = mergeIntervals(boxes.filter((b) => b[0] <= base + wig && b[2] >= base - wig).map((b) => [Math.max(minZ, zLo, b[1]), Math.min(maxZ, zHi, b[3])]));
      for (const [z0, z1] of spans) sampleCityCurve("arterialSeg", z0, z1, (z) => ({ x: citySegEdgeX(r, m, z), z }), out);
    }
  }
};

/** A piece's footprint half-width at its arc fraction t (+ the meander), real units. */
const footprintAt = (scan: WindowScan, p: RiverPiece, t: number): number => scan.reach * (p.w0 + (p.w1 - p.w0) * t) + RIVER_MEANDER_AMP;

/** A freeway the city carries along the bank is not where its line is: a BELT the WATERFRONT takes
 *  along the water (its wall drowned: in the river's footprint, along the river — cityTerrain's
 *  wallDrownedAt past half) and a city ARTERIAL following the river inside its footprint (within
 *  QUAY_ALONG_COS of it), which the QUAY road carries along the bank. No deck is wanted there, and a
 *  stretch of the road crossing the river beside it is its own, from where it comes out of that
 *  stretch — LANDED there when that is dry land (a belt corner on the bank), OPEN when it is in the
 *  water (a lone mouth's deck lands on the waterfront or the quay across). Uncut, a belt's wall at 30°
 *  to the river, carried on the bank, merges with the next wall crossing it into one V-shaped chain
 *  that drops as "along the shore" — and the run meeting them ends at the bank. The path is cut there; riverNetwork's road layer judges the same stretches from the edge alone. */
const QUAY_ALONG_COS = Math.cos((35 * Math.PI) / 180);
export const withoutCarriedStretches = (paths: RoadPath[]): RoadPath[] => {
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const out: RoadPath[] = [];
  for (const p of paths) {
    if (p.kind === "run") {
      out.push(p);
      continue;
    }
    const n = p.wx.length;
    let part: RoadPath | null = null;
    let lastDry = false;
    for (let i = 0; i < n; i++) {
      riverFieldAt(p.wx[i], p.wz[i]);
      const dry = !(riverSample.distance < reach);
      let carried = false;
      if (!dry) {
        const j = Math.min(n - 1, i + 1);
        const k = Math.max(0, i - 1);
        const dx = p.wx[j] - p.wx[k];
        const dz = p.wz[j] - p.wz[k];
        if (p.kind === "belt") carried = wallDrownedAt(p.wx[i], p.wz[i], dx, dz) > 0.5;
        else {
          riverStraightNear(p.wx[i], p.wz[i]);
          carried = Math.abs(dx * riverStraight.dirX + dz * riverStraight.dirZ) > QUAY_ALONG_COS * Math.hypot(dx, dz);
        }
      }
      if (carried) {
        if (part && part.wx.length > 1) {
          part.landed![1] = lastDry;
          part.carried![1] = true;
          out.push(part);
        }
        part = null;
        continue;
      }
      if (!part) {
        part = newPath(p.kind);
        part.landed = [i > 0 && dry, false];
        part.carried = [i > 0, false];
      }
      lastDry = dry;
      part.wx.push(p.wx[i]);
      part.wz.push(p.wz[i]);
      part.x.push(p.x[i]);
      part.z.push(p.z[i]);
    }
    if (part && part.wx.length > 1) out.push(part);
  }
  return out;
};

/** 1. Every road stretch near the window's rivers — the runs, the belts, the arterials — clipped
 *  to the window. */
export const collectRoadPaths = (scan: WindowScan): RoadPath[] => {
  const { win, pieces, reach } = scan;
  const nearRivers = (ax: number, az: number, bx: number, bz: number): boolean => {
    for (const p of pieces) {
      const r = footprintAt(scan, p, 0.5) + reach * Math.abs(p.w1 - p.w0) + BRIDGE_ROAD_MARGIN;
      if (Math.max(ax, bx) < Math.min(p.sx, p.ex) - r || Math.min(ax, bx) > Math.max(p.sx, p.ex) + r) continue;
      if (Math.max(az, bz) < Math.min(p.sz, p.ez) - r || Math.min(az, bz) > Math.max(p.sz, p.ez) + r) continue;
      if (segSegDistance(ax, az, bx, bz, p.sx, p.sz, p.ex, p.ez) < r) return true;
    }
    return false;
  };
  const legWanted = (ax: number, az: number, bx: number, bz: number) => boxMeetsWindow(ax, az, bx, bz, win) && nearRivers(ax, az, bx, bz);

  const paths: RoadPath[] = [];
  for (const run of getNetwork(scan.center).freeways) {
    let path: RoadPath | null = null;
    for (let k = 0; k + 3 < run.pts.length; k += 2) {
      const [ax, az, bx, bz] = [run.pts[k], run.pts[k + 1], run.pts[k + 2], run.pts[k + 3]];
      if (!legWanted(ax, az, bx, bz)) {
        if (path) clipPath(path, win, paths);
        path = null;
        continue;
      }
      if (!path) {
        path = newPath("run");
        pushWarped(path, ax, az);
      }
      pushLeg(path, ax, az, bx, bz);
    }
    if (path) clipPath(path, win, paths);
  }
  const gs = domainConfig!.gridSize;
  const cells = new Map<string, [number, number]>();
  for (const p of pieces) {
    const r = footprintAt(scan, p, p.w0 > p.w1 ? 0 : 1) + BRIDGE_ROAD_MARGIN + gs / 2;
    for (let ix = Math.floor((Math.min(p.sx, p.ex) - r) / gs); ix <= Math.floor((Math.max(p.sx, p.ex) + r) / gs); ix++) {
      for (let iz = Math.floor((Math.min(p.sz, p.ez) - r) / gs); iz <= Math.floor((Math.max(p.sz, p.ez) + r) / gs); iz++) {
        if ((ix + 1) * gs < win.x0 || ix * gs > win.x1 || (iz + 1) * gs < win.z0 || iz * gs > win.z1) continue;
        cells.set(`${ix},${iz}`, [ix, iz]);
      }
    }
  }
  const cityNear = collectBeltPaths(cells.values(), legWanted, win, paths);
  if (cityNear || pieces.some((p) => zoneAtWarped((p.sx + p.ex) / 2, (p.sz + p.ez) / 2).biome.id === CITY_BIOME_ID)) {
    // World boxes around every footprint (the warp bends little over a piece; +20 covers it).
    const boxes = pieces.map((p) => {
      const a = unwarp(p.sx, p.sz);
      const b = unwarp(p.ex, p.ez);
      const r = footprintAt(scan, p, p.w0 > p.w1 ? 0 : 1) + BRIDGE_ROAD_MARGIN + 20;
      return [Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r];
    });
    // The world window holds every world point the warped one can (the warp moves a point, the
    // window's center included, ≤ warpMax() per axis).
    const ww = scan.size + 2 * warpMax() + 10;
    const arterials: RoadPath[] = [];
    collectArterialPaths(scan.cx - ww, scan.cz - ww, scan.cx + ww, scan.cz + ww, boxes, arterials);
    for (const path of arterials) clipPath(path, win, paths);
  }
  return paths;
};

/** While riverNetwork's road layer asks for an edge's roads, a loop's seam is chosen by the distance to
 *  that edge's own pieces: the per-vertex field would read the road layer being built. */
let seamDryness: ((x: number, z: number) => number) | null = null;

/** edgeRoadPaths for riverNetwork's road layer, which decides `pieces`: blind to the river field. */
export const edgeRoadPathsUnbuilt = (e: RiverEdge, pieces: RiverPiece[]): RoadPath[] => {
  const outer = seamDryness;
  seamDryness = (x, z) => {
    let d = Infinity;
    for (const p of pieces) d = Math.min(d, distanceToSegment(x, z, p.sx, p.sz, p.ex, p.ez));
    return Math.min(d, 1e9);
  };
  try {
    return edgeRoadPaths(e, pieces);
  } finally {
    seamDryness = outer;
  }
};

/** Every freeway near edge e's built pieces: the city arterials, the belts and the inter-city runs
 *  (each run leg once, from every piece's own network — the one the terrain rides). */
export const edgeRoadPaths = (e: RiverEdge, pieces: RiverPiece[]): RoadPath[] => {
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const gs = domainConfig!.gridSize;
  const paths: RoadPath[] = [];
  const nearPieces = (ax: number, az: number, bx: number, bz: number): boolean => {
    for (const p of pieces) {
      const r = reach * Math.max(p.w0, p.w1) + RIVER_MEANDER_AMP + BRIDGE_ROAD_MARGIN;
      if (Math.max(ax, bx) < Math.min(p.sx, p.ex) - r || Math.min(ax, bx) > Math.max(p.sx, p.ex) + r) continue;
      if (Math.max(az, bz) < Math.min(p.sz, p.ez) - r || Math.min(az, bz) > Math.max(p.sz, p.ez) + r) continue;
      if (segSegDistance(ax, az, bx, bz, p.sx, p.sz, p.ex, p.ez) < r) return true;
    }
    return false;
  };
  const everywhere: BridgeWindow = { x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };
  // Keyed to the chaining's own 0.01u node tolerance: two runs sharing a wall carry it with ulps of
  // difference, and both copies chained into an out-and-back "loop" through the river.
  const legKey = (ax: number, az: number, bx: number, bz: number) => {
    const [p, q, r, t] = [ax, az, bx, bz].map((v) => Math.round(v * 100));
    return p < r || (p === r && q <= t) ? `${p},${q},${r},${t}` : `${r},${t},${p},${q}`;
  };
  const runLegs = new Map<string, number[]>();
  for (const p of pieces) {
    for (const run of getNetwork({ x: (p.sx + p.ex) / 2, z: (p.sz + p.ez) / 2 }).freeways) {
      for (let k = 0; k + 3 < run.pts.length; k += 2) {
        const leg = [run.pts[k], run.pts[k + 1], run.pts[k + 2], run.pts[k + 3]];
        const key = legKey(leg[0], leg[1], leg[2], leg[3]);
        if (!runLegs.has(key) && nearPieces(leg[0], leg[1], leg[2], leg[3])) runLegs.set(key, leg);
      }
    }
  }
  chainLegs([...runLegs.keys()].sort().map((k) => runLegs.get(k)!), "run", everywhere, paths);
  const cells = new Map<string, [number, number]>();
  const boxes: number[][] = [];
  for (const p of pieces) {
    const r = reach * Math.max(p.w0, p.w1) + RIVER_MEANDER_AMP + BRIDGE_ROAD_MARGIN + gs / 2;
    for (let ix = Math.floor((Math.min(p.sx, p.ex) - r) / gs); ix <= Math.floor((Math.max(p.sx, p.ex) + r) / gs); ix++) {
      for (let iz = Math.floor((Math.min(p.sz, p.ez) - r) / gs); iz <= Math.floor((Math.max(p.sz, p.ez) + r) / gs); iz++) cells.set(`${ix},${iz}`, [ix, iz]);
    }
    // Arterials only where a city is near the piece (they are sampled in the city alone).
    const mx = (p.sx + p.ex) / 2;
    const mz = (p.sz + p.ez) / 2;
    const off = reach * Math.max(p.w0, p.w1) * 1.7 + BRIDGE_ROAD_MARGIN;
    const near = [0, 1, -1].some((k) => [0, 1, -1].some((j) => zoneAtWarped(mx + e.ux * j * 25 - e.uz * k * off, mz + e.uz * j * 25 + e.ux * k * off).biome.id === CITY_BIOME_ID));
    if (!near) continue;
    const a = unwarp(p.sx, p.sz);
    const b = unwarp(p.ex, p.ez);
    const rb = reach * Math.max(p.w0, p.w1) * 1.7 + RIVER_MEANDER_AMP + BRIDGE_ROAD_MARGIN + 20;
    boxes.push([Math.min(a.x, b.x) - rb, Math.min(a.z, b.z) - rb, Math.max(a.x, b.x) + rb, Math.max(a.z, b.z) + rb]);
  }
  collectBeltPaths([...cells.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]), nearPieces, everywhere, paths);
  if (boxes.length > 0) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[1]);
      x1 = Math.max(x1, b[2]); z1 = Math.max(z1, b[3]);
    }
    collectArterialPaths(x0, z0, x1, z1, boxes, paths);
  }
  return paths;
};
