/**
 * The per-vertex RIVER FIELD (layer 3 of riverNetwork.ts's header): distance in factor-1 units,
 * width factor and water surface at a warped point, and the straight-point variant the city's quay
 * roads follow. Evaluated from per-biome-cell lists of the pieces that can reach the cell.
 */

import { smoothstep } from "../../math/_math";
import { CellCache, dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { lakeSurface, lastShore } from "../lakes";
import { simplex2, unwarp } from "../noise";
import { CITY_BIOME_ID } from "../../../world/constants";
import { getNetwork } from "../roads/freewayNetwork";
import { RIVER_FILLET, RIVER_MEANDER_AMP, RIVER_MEANDER_SCALE, RIVER_SURFACE_BELOW, type RiverEdge, type RiverPiece, riverMaxReach, riverPiecesIn, riversEnabled } from "./riverNetwork";
import type { RiverQuaySample } from "../types";
import { blendedTerrainAt } from "../vertexCompute";
import { getBiomeContext, wallsOfBiome } from "../voronoi";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights } from "../zoneBlend";

// ── The water surface ──────────────────────────────────────────────────

/** A river reaching a lake settles onto its level over this far from the lake's wall (real units):
 *  hung from the terrain alone, a mouth's surface stands ~11u over the lake at the wall and drops
 *  to it over one 50u piece — a stepped, jagged sheet of water (MEASURED). */
const RIVER_MOUTH_APPROACH = 250;

/** Surface at a (warped) CENTERLINE point: the terrain there — its own wall pass, the city at its
 *  plateau FLOOR (a surface hung from the freeway grade had blocks under it), lifted with a lake's
 *  shore — minus RIVER_SURFACE_BELOW. Near a lake it eases onto the lake's level (never below it on
 *  land, never above it in the water — there the channel stays sunk under the lake, or its bank
 *  rule would raise a levee across the lakebed). Runs before the calling vertex's own wall pass (it
 *  clobbers the scratch), never recurses into rivers, and is cached per point. */
const riverSurfaceCache = new Map<string, number>();
const riverSurfaceAt = (wx: number, wz: number): number => {
  const key = `${wx},${wz}`;
  let h = riverSurfaceCache.get(key);
  if (h === undefined) {
    if (riverSurfaceCache.size > 16384) dropOldestHalf(riverSurfaceCache);
    const warped = { x: wx, z: wz };
    const ctx = getBiomeContext(warped);
    accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
    combineZoneWeights(zoneWeights, zoneFinal);
    const inLake = lakeSurface(warped, ctx, ctx.zone);
    const shore = lastShore();
    const world = unwarp(wx, wz);
    h = blendedTerrainAt(world.x, world.z, ctx.zone, ctx, 0) - RIVER_SURFACE_BELOW;
    if (ctx.zone.biome.water) {
      if (!Number.isNaN(inLake)) h = Math.min(h, inLake);
    } else if (!Number.isNaN(shore.level)) {
      h = shore.level + Math.max(0, h - shore.level) * smoothstep(0, RIVER_MOUTH_APPROACH, shore.dWater);
    }
    riverSurfaceCache.set(key, h);
  }
  return h;
};

// ── Roads over the river ───────────────────────────────────────────────

/** A freeway crossing a river — an inter-city run, a city's belt — is decked flat from its road on
 *  one bank to its road on the other, so the surface where it crosses stands this far under the
 *  lower of its two landings (the deck lifts 1u off the road and clears the water by 4.5 —
 *  bridges' BRIDGE_DECK_LIFT and BRIDGE_WATER_CLEARANCE — plus a margin). Without it a river along
 *  a crest 15–17u over the valleys a road comes through raises its banks as a levee the road must
 *  climb, and the deck needs a 43u arch, so none is built (MEASURED). */
const RIVER_ROAD_CLEARANCE = 5;
/** Where the landings are sampled: past the river's footprint along the road, by this much. */
const RIVER_ROAD_LANDING_PAST = 12;

/** The road grade at a warped point: the zone-weighted terrain, as a freeway rides it. Its shore lift
 *  is the CURRENT shore state (lakes.ts) — roadCrossingCap sets it to the river point's first. Clobbers
 *  the wall-pass scratch (like riverSurfaceAt, it runs before a vertex's own wall pass). */
const roadGradeAt = (wx: number, wz: number): number => {
  const warped = { x: wx, z: wz };
  const ctx = getBiomeContext(warped);
  accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  const world = unwarp(wx, wz);
  return blendedTerrainAt(world.x, world.z, ctx.zone, ctx);
};

/** Sets the shore state (lakes.ts) to a warped point's own — its wall pass, then lakeSurface. */
const setShoreAt = (wx: number, wz: number): void => {
  const warped = { x: wx, z: wz };
  const ctx = getBiomeContext(warped);
  accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, ctx, ctx.zone);
};

/** The highest the surface may stand at edge e's piece end k (Infinity when no freeway crosses the
 *  two pieces beside it): every run and belt crossing them lands at least RIVER_ROAD_CLEARANCE over
 *  it. A function of the edge and the roads alone, per end, so the two pieces sharing the end agree. */
const roadCapCache = new Map<string, number>();
const roadCrossingCap = (e: RiverEdge, k: number): number => {
  const key = `${e.key}:${k}`;
  let cap = roadCapCache.get(key);
  if (cap !== undefined) return cap;
  if (roadCapCache.size > 16384) dropOldestHalf(roadCapCache);
  cap = Infinity;
  const step = e.len / e.count;
  const s0 = Math.max(0, k - 1) * step;
  const s1 = Math.min(e.count, k + 1) * step;
  const ax = e.ax + e.ux * s0;
  const az = e.az + e.uz * s0;
  const bx = e.ax + e.ux * s1;
  const bz = e.az + e.uz * s1;
  const px = e.ax + e.ux * k * step;
  const pz = e.az + e.uz * k * step;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const legs: number[][] = [];
  for (const run of getNetwork({ x: px, z: pz }).freeways) {
    if (run.maxX < Math.min(ax, bx) || run.minX > Math.max(ax, bx) || run.maxZ < Math.min(az, bz) || run.minZ > Math.max(az, bz)) continue;
    for (let j = 0; j + 3 < run.pts.length; j += 2) legs.push([run.pts[j], run.pts[j + 1], run.pts[j + 2], run.pts[j + 3]]);
  }
  for (const w of wallsOfBiome(getBiomeContext({ x: px, z: pz }).zoneWalls, CITY_BIOME_ID)) legs.push([w.sx, w.sz, w.ex, w.ez]);
  const crossings: { x: number; z: number; dx: number; dz: number; f: number }[] = [];
  for (const [cx, cz, dx2, dz2] of legs) {
    const rx = bx - ax;
    const rz = bz - az;
    const sx = dx2 - cx;
    const sz = dz2 - cz;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((cx - ax) * sz - (cz - az) * sx) / den;
    const u = ((cx - ax) * rz - (cz - az) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const sl = Math.hypot(sx, sz) || 1;
    const along = s0 + (s1 - s0) * t;
    const i = Math.min(e.count - 1, Math.floor(along / step));
    const f = e.widths ? e.widths[i] + (e.widths[i + 1] - e.widths[i]) * (along / step - i) : 1;
    crossings.push({ x: ax + rx * t, z: az + rz * t, dx: sx / sl, dz: sz / sl, f });
  }
  // The landing grades are lifted with the shore of the river point (px, pz) itself, set here: left to
  // whatever the last lakeSurface stored, the cap depended on evaluation order (a riverSurfaceAt cache
  // hit left another point's shore — the two edges meeting at one junction read different ones).
  if (crossings.length > 0) setShoreAt(px, pz);
  for (const c of crossings) {
    const out = reach * c.f + RIVER_MEANDER_AMP + RIVER_ROAD_LANDING_PAST;
    const low = Math.min(roadGradeAt(c.x + c.dx * out, c.z + c.dz * out), roadGradeAt(c.x - c.dx * out, c.z - c.dz * out));
    cap = Math.min(cap, low - RIVER_ROAD_CLEARANCE);
  }
  roadCapCache.set(key, cap);
  return cap;
};

/** A piece end's surface: the terrain's (riverSurfaceAt), under any freeway crossing beside it. */
const pieceEndSurface = (p: RiverPiece, which: 0 | 1): number => {
  const h = which === 0 ? riverSurfaceAt(p.sx, p.sz) : riverSurfaceAt(p.ex, p.ez);
  return Math.min(h, roadCrossingCap(p.edge, p.index + which));
};

// ── Per-cell piece lists ───────────────────────────────────────────────

/** The pieces that can reach a biome-grid cell, with their surfaces at both ends, grouped by edge. */
interface RiverCellList {
  n: number;
  sx: Float64Array;
  sz: Float64Array;
  ex: Float64Array;
  ez: Float64Array;
  w0: Float64Array;
  w1: Float64Array;
  h0: Float64Array;
  h1: Float64Array;
  group: Int32Array;
  groups: number;
  cx: number;
  cz: number;
}
const riverCellLists = new CellCache<RiverCellList>(2048);
let lastRiverCellList: RiverCellList | null = null;

const buildRiverCellList = (cx: number, cz: number): RiverCellList => {
  const gs = domainConfig!.gridSize;
  const pieces = riverPiecesIn({ x: (cx + 0.5) * gs, z: (cz + 0.5) * gs }, cx * gs, cz * gs, (cx + 1) * gs, (cz + 1) * gs, riverMaxReach());
  pieces.sort((a, b) => (a.edge.key < b.edge.key ? -1 : a.edge.key > b.edge.key ? 1 : 0));
  const n = pieces.length;
  const list: RiverCellList = {
    n,
    sx: new Float64Array(n),
    sz: new Float64Array(n),
    ex: new Float64Array(n),
    ez: new Float64Array(n),
    w0: new Float64Array(n),
    w1: new Float64Array(n),
    h0: new Float64Array(n),
    h1: new Float64Array(n),
    group: new Int32Array(n),
    groups: 0,
    cx,
    cz,
  };
  for (let j = 0; j < n; j++) {
    const p = pieces[j];
    if (j === 0 || p.edge !== pieces[j - 1].edge) list.groups++;
    list.group[j] = list.groups - 1;
    list.sx[j] = p.sx;
    list.sz[j] = p.sz;
    list.ex[j] = p.ex;
    list.ez[j] = p.ez;
    list.w0[j] = p.w0;
    list.w1[j] = p.w1;
    list.h0[j] = pieceEndSurface(p, 0);
    list.h1[j] = pieceEndSurface(p, 1);
  }
  return list;
};

const riverCellList = (px: number, pz: number): RiverCellList => {
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(px / gs);
  const cz = Math.floor(pz / gs);
  if (lastRiverCellList && lastRiverCellList.cx === cx && lastRiverCellList.cz === cz) return lastRiverCellList;
  let list = riverCellLists.get(cx, cz);
  if (!list) {
    riverCellLists.makeRoom();
    list = buildRiverCellList(cx, cz);
    riverCellLists.set(cx, cz, list);
  }
  lastRiverCellList = list;
  return list;
};

// ── The per-vertex field ───────────────────────────────────────────────

/** What the last riverFieldAt found. `distance` is in factor-1 units (Infinity when no river is in
 *  reach), `factor` the local width factor, `surface` the water surface on the centerline (NaN). */
export const riverSample = { distance: Infinity, factor: 1, surface: NaN };
/** What the last riverQuayAt found (see RiverQuaySample). */
export const riverQuay: RiverQuaySample = { distance: Infinity, factor: 1, dirX: 1, dirZ: 0 };

// Per-edge scratch (workers are single-threaded), grown by ensureEdgeScratch.
let edgeDist = new Float64Array(16);
let edgeFactor = new Float64Array(16);
let edgeSurface = new Float64Array(16);
let edgeQuayDist = new Float64Array(16);
let edgeQuayFactor = new Float64Array(16);
let edgeQuayX = new Float64Array(16);
let edgeQuayZ = new Float64Array(16);
/** Per-edge smooth-minimum weights (edgeSmoothMin). */
let edgeWeight = new Float64Array(16);
/** The smooth minimum edgeSmoothMin computed. */
let smoothMinDist = Infinity;

/** Compact smooth minimum over the per-edge distances in `d`: each edge within RIVER_FILLET of the
 *  nearest weighs h² (h = 1 − gap/FILLET), the distance drops by up to FILLET/4 where two meet —
 *  continuous, order-free, and exactly the plain minimum wherever only one river is near. Returns
 *  the weight sum; the per-edge weights are left in edgeWeight, the minimum in smoothMinDist. */
const edgeSmoothMin = (d: Float64Array, groups: number): number => {
  let dmin = Infinity;
  for (let g = 0; g < groups; g++) if (d[g] < dmin) dmin = d[g];
  let sum = 0;
  for (let g = 0; g < groups; g++) {
    const h = 1 - (d[g] - dmin) / RIVER_FILLET;
    edgeWeight[g] = h > 0 ? h * h : 0;
    sum += edgeWeight[g];
  }
  smoothMinDist = Math.max(0, dmin - (RIVER_FILLET / 4) * Math.min(1, sum - 1));
  return sum;
};

const ensureEdgeScratch = (groups: number): void => {
  if (edgeDist.length < groups) {
    const size = groups * 2;
    edgeDist = new Float64Array(size);
    edgeFactor = new Float64Array(size);
    edgeSurface = new Float64Array(size);
    edgeQuayDist = new Float64Array(size);
    edgeQuayFactor = new Float64Array(size);
    edgeQuayX = new Float64Array(size);
    edgeQuayZ = new Float64Array(size);
    edgeWeight = new Float64Array(size);
  }
};

/** Sets riverSample to "no river in reach" — what a far visual-only vertex reports (computeVertexDataFar). */
export const noRiverSample = (): void => {
  riverSample.distance = Infinity;
  riverSample.factor = 1;
  riverSample.surface = NaN;
};

/** Sets riverSample for a warped point, measured from a meandered query point (±RIVER_MEANDER_AMP)
 *  so a straight edge winds. */
export const riverFieldAt = (px: number, pz: number): void => {
  noRiverSample();
  if (!riversEnabled) return;
  const list = riverCellList(px, pz);
  if (list.n === 0) return;
  const groups = list.groups;
  ensureEdgeScratch(groups);
  edgeDist.fill(Infinity, 0, groups);
  const qx = px + RIVER_MEANDER_AMP * simplex2(px / RIVER_MEANDER_SCALE, pz / RIVER_MEANDER_SCALE);
  const qz = pz + RIVER_MEANDER_AMP * simplex2(pz / RIVER_MEANDER_SCALE + 7.31, px / RIVER_MEANDER_SCALE - 3.17);
  for (let j = 0; j < list.n; j++) {
    const g = list.group[j];
    const sx = list.sx[j];
    const sz = list.sz[j];
    const dx = list.ex[j] - sx;
    const dz = list.ez[j] - sz;
    const l2 = dx * dx + dz * dz;
    let t = ((qx - sx) * dx + (qz - sz) * dz) / l2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const f = list.w0[j] + (list.w1[j] - list.w0[j]) * t;
    const d = Math.hypot(qx - (sx + dx * t), qz - (sz + dz * t)) / f;
    if (d < edgeDist[g]) {
      edgeDist[g] = d;
      edgeFactor[g] = f;
      edgeSurface[g] = list.h0[j] + (list.h1[j] - list.h0[j]) * t;
    }
  }
  const sum = edgeSmoothMin(edgeDist, groups);
  let wf = 0;
  let ws = 0;
  for (let g = 0; g < groups; g++) {
    if (edgeWeight[g] === 0) continue;
    wf += edgeWeight[g] * edgeFactor[g];
    ws += edgeWeight[g] * edgeSurface[g];
  }
  riverSample.distance = smoothMinDist;
  riverSample.factor = wf / sum;
  riverSample.surface = ws / sum;
};

/** Sets riverQuay to "no river in reach". */
export const noRiverQuay = (): void => {
  riverQuay.distance = Infinity;
  riverQuay.factor = 1;
};

/** Sets riverQuay for a warped point: the river field from the STRAIGHT point. Only the city's
 *  quay (and the belt beside a river, step 5) reads it, after the vertex's riverFieldAt built the list. */
export const riverQuayAt = (px: number, pz: number): void => {
  noRiverQuay();
  if (!riversEnabled) return;
  const list = riverCellList(px, pz);
  if (list.n === 0) return;
  const groups = list.groups;
  ensureEdgeScratch(groups);
  edgeQuayDist.fill(Infinity, 0, groups);
  for (let j = 0; j < list.n; j++) {
    const g = list.group[j];
    const sx = list.sx[j];
    const sz = list.sz[j];
    const dx = list.ex[j] - sx;
    const dz = list.ez[j] - sz;
    let t = ((px - sx) * dx + (pz - sz) * dz) / (dx * dx + dz * dz);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const f = list.w0[j] + (list.w1[j] - list.w0[j]) * t;
    const cxp = sx + dx * t;
    const czp = sz + dz * t;
    const d = Math.hypot(px - cxp, pz - czp) / f;
    if (d < edgeQuayDist[g]) {
      edgeQuayDist[g] = d;
      edgeQuayFactor[g] = f;
      edgeQuayX[g] = cxp;
      edgeQuayZ[g] = czp;
    }
  }
  const sum = edgeSmoothMin(edgeQuayDist, groups);
  let qf = 0;
  let ux = 0;
  let uz = 0;
  for (let g = 0; g < groups; g++) {
    if (edgeWeight[g] === 0) continue;
    qf += edgeWeight[g] * edgeQuayFactor[g];
    const vx = edgeQuayX[g] - px;
    const vz = edgeQuayZ[g] - pz;
    const vl = Math.hypot(vx, vz);
    if (vl > 1e-9) {
      ux += (edgeWeight[g] * vx) / vl;
      uz += (edgeWeight[g] * vz) / vl;
    }
  }
  riverQuay.factor = qf / sum;
  riverQuay.distance = smoothMinDist * riverQuay.factor;
  const ul = Math.hypot(ux, uz);
  if (ul > 1e-9) {
    riverQuay.dirX = ux / ul;
    riverQuay.dirZ = uz / ul;
  } else {
    riverQuay.dirX = 1;
    riverQuay.dirZ = 0;
  }
};

/** The nearest river centerline's STRAIGHT distance (real units) and width factor at a warped point
 *  near the last vertex asked about, from that vertex's piece list — never building one (building a
 *  list evaluates the terrain, and callers are in the middle of a vertex). Infinity when none is in it. */
export const riverStraight = { distance: Infinity, factor: 1, dirX: 1, dirZ: 0 };
export const riverStraightNear = (px: number, pz: number): void => {
  riverStraight.distance = Infinity;
  riverStraight.factor = 1;
  const list = lastRiverCellList;
  if (!list) return;
  let best = Infinity;
  for (let j = 0; j < list.n; j++) {
    const sx = list.sx[j];
    const sz = list.sz[j];
    const dx = list.ex[j] - sx;
    const dz = list.ez[j] - sz;
    let t = ((px - sx) * dx + (pz - sz) * dz) / (dx * dx + dz * dz);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const f = list.w0[j] + (list.w1[j] - list.w0[j]) * t;
    const d = Math.hypot(px - (sx + dx * t), pz - (sz + dz * t));
    if (d / f < best) {
      best = d / f;
      riverStraight.distance = d;
      riverStraight.factor = f;
      const l = Math.hypot(dx, dz) || 1;
      riverStraight.dirX = dx / l;
      riverStraight.dirZ = dz / l;
    }
  }
};

/** The last vertex's piece list as a cache key (per-list caches of what walls see of the rivers). */
export const riverListKey = (): unknown => lastRiverCellList;

/** Whether any river piece of the last vertex's list comes within its footprint (reach × its width
 *  factor) + `extra` of a warped segment — per segment and list, cached: most city walls lie nowhere
 *  near a river, and the waterfront test (cityTerrain) asks about each of them at every vertex. */
const segmentNearCache = new WeakMap<object, { list: RiverCellList; extra: number; near: boolean }>();
export const riverListNearSegment = (key: object, ax: number, az: number, bx: number, bz: number, reach: number, extra: number): boolean => {
  const list = lastRiverCellList;
  if (!list || list.n === 0) return false;
  const hit = segmentNearCache.get(key);
  if (hit && hit.list === list && hit.extra === extra) return hit.near;
  let near = false;
  for (let j = 0; j < list.n && !near; j++) {
    const r = reach * Math.max(list.w0[j], list.w1[j]) + extra;
    // Segment–segment distance by the four endpoint projections (0 when they cross).
    const sx = list.sx[j], sz = list.sz[j], ex = list.ex[j], ez = list.ez[j];
    const d = Math.min(pointSeg(ax, az, sx, sz, ex, ez), pointSeg(bx, bz, sx, sz, ex, ez), pointSeg(sx, sz, ax, az, bx, bz), pointSeg(ex, ez, ax, az, bx, bz));
    const crosses = cross(ax, az, bx, bz, sx, sz) * cross(ax, az, bx, bz, ex, ez) < 0 && cross(sx, sz, ex, ez, ax, az) * cross(sx, sz, ex, ez, bx, bz) < 0;
    if (crosses || d < r) near = true;
  }
  segmentNearCache.set(key, { list, extra, near });
  return near;
};
const cross = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
const pointSeg = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};

export const clearRiverField = (): void => {
  roadCapCache.clear();
  riverCellLists.clear();
  lastRiverCellList = null;
  riverSurfaceCache.clear();
};
