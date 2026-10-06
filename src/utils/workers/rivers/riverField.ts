/**
 * The per-vertex RIVER FIELD (layer 3 of riverNetwork.ts's header): distance in factor-1 units,
 * width factor and water surface at a warped point, and the straight-point variant the city's quay
 * roads follow. Evaluated from per-biome-cell lists of the pieces that can reach the cell.
 */

import { CellCache, PointCache } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { lakeSurface, riverMouthShare, riverSurfaceBesideCrispShore } from "../lakes";
import { simplex2, unwarp } from "../noise";
import type { RiverQuaySample } from "../types";
import { blendedTerrainAt } from "../vertexCompute";
import { carveRiverChannel } from "./riverChannel";
import { RIVER_BED_FULL_INSET } from "../../../world/shaders/constants";
import { getBiomeContext } from "../voronoi";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights } from "../zoneBlend";
import { RIVER_FILLET, RIVER_MEANDER_AMP, RIVER_MEANDER_SCALE, riverMaxReach } from "./constants";
import { RIVER_BED_CAP_FADE, RIVER_BED_LIMIT_PAST, bedLimitOfPiece, clearRiverBedLimits } from "./riverBedLimit";
import { riverPiecesIn, riversEnabled } from "./riverNetwork";
import { clearRiverSurfaces, riverPieceEndLevel, riverPieceEndShore, riverPieceEndSurface, setShoreAt } from "./riverSurface";
import type { RiverPiece } from "./types";

// ── Per-cell piece lists ───────────────────────────────────────────────

/** The pieces that can reach a biome-grid cell, with their surfaces at both ends, grouped by edge and,
 *  within an edge, into RUNS of consecutive pieces (an edge's unbuilt pieces split it). */
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
  /** The centerline's signed distance to its nearest water wall at both ends (riverPieceEndShore). */
  d0: Float64Array;
  d1: Float64Array;
  /** …and the lake level there (riverPieceEndLevel). */
  l0: Float64Array;
  l1: Float64Array;
  /** The pieces themselves (the bed limits march from their stations). */
  pieces: RiverPiece[];
  group: Int32Array;
  groups: number;
  run: Int32Array;
  runs: number;
  cx: number;
  cz: number;
}
const riverCellLists = new CellCache<RiverCellList>(2048);
let lastRiverCellList: RiverCellList | null = null;

const buildRiverCellList = (cx: number, cz: number): RiverCellList => {
  const gs = domainConfig!.gridSize;
  const pieces = riverPiecesIn({ x: (cx + 0.5) * gs, z: (cz + 0.5) * gs }, cx * gs, cz * gs, (cx + 1) * gs, (cz + 1) * gs, riverMaxReach());
  pieces.sort((a, b) => (a.edge.key < b.edge.key ? -1 : a.edge.key > b.edge.key ? 1 : a.index - b.index));
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
    d0: new Float64Array(n),
    d1: new Float64Array(n),
    l0: new Float64Array(n),
    l1: new Float64Array(n),
    pieces,
    group: new Int32Array(n),
    groups: 0,
    run: new Int32Array(n),
    runs: 0,
    cx,
    cz,
  };
  for (let j = 0; j < n; j++) {
    const p = pieces[j];
    if (j === 0 || p.edge !== pieces[j - 1].edge) list.groups++;
    list.group[j] = list.groups - 1;
    if (j === 0 || p.edge !== pieces[j - 1].edge || p.index !== pieces[j - 1].index + 1) list.runs++;
    list.run[j] = list.runs - 1;
    list.sx[j] = p.sx;
    list.sz[j] = p.sz;
    list.ex[j] = p.ex;
    list.ez[j] = p.ez;
    list.w0[j] = p.w0;
    list.w1[j] = p.w1;
    list.h0[j] = riverPieceEndSurface(p, 0);
    list.h1[j] = riverPieceEndSurface(p, 1);
    list.d0[j] = riverPieceEndShore(p, 0);
    list.d1[j] = riverPieceEndShore(p, 1);
    list.l0[j] = riverPieceEndLevel(p, 0);
    list.l1[j] = riverPieceEndLevel(p, 1);
  }
  return list;
};

/** A cell's piece list (built on a miss), leaving lastRiverCellList alone. */
const riverCellListAt = (px: number, pz: number): RiverCellList => {
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
  return list;
};

const riverCellList = (px: number, pz: number): RiverCellList => {
  const list = riverCellListAt(px, pz);
  lastRiverCellList = list;
  return list;
};

// ── The per-vertex field ───────────────────────────────────────────────

/** What the last riverFieldAt found. `distance` is in factor-1 units (Infinity when no river is in
 *  reach), `factor` the local width factor, `surface` the water surface on the centerline (NaN),
 *  `bedLimit` how far out the riverbed reaches here before its bank first gets too steep (factor-1;
 *  Infinity where no river is in reach — capRiverBed), `shore` the centerline's signed distance to the
 *  nearest water wall (riverPieceEndShore; Infinity where no river is in reach — riverLakeMerge) and
 *  `level` the lake level there (riverPieceEndLevel). */
export const riverSample = { distance: Infinity, factor: 1, surface: NaN, bedLimit: Infinity, shore: Infinity, level: NaN };
/** What the last riverQuayAt found (see RiverQuaySample). */
export const riverQuay: RiverQuaySample = { distance: Infinity, factor: 1, dirX: 1, dirZ: 0 };

// Per-edge and per-run scratch (workers are single-threaded), grown by ensureFieldScratch.
let edgeDist = new Float64Array(16);
/** Per-edge smooth-minimum weights (edgeSmoothMin). */
let edgeWeight = new Float64Array(16);
/** The smooth minimum edgeSmoothMin computed. */
let smoothMinDist = Infinity;
/** Per RUN (RiverCellList): its nearest distance (factor-1), its smooth-minimum weight, and what its
 *  PLAINLY nearest piece reads — list index, t, width factor, surface, the foot of the perpendicular,
 *  and the sine / past-end cosine of the vertex's angle off it (bedLimitOfPiece). */
let runDist = new Float64Array(16);
let runWeight = new Float64Array(16);
let runPlain = new Float64Array(16);
let runPiece = new Int32Array(16);
let runT = new Float64Array(16);
let runFactor = new Float64Array(16);
let runSurface = new Float64Array(16);
let runShore = new Float64Array(16);
let runLevel = new Float64Array(16);
let runSideCos = new Float64Array(16);
let runOutCos = new Float64Array(16);
let runFootX = new Float64Array(16);
let runFootZ = new Float64Array(16);

/** Compact smooth minimum over the per-edge distances in `d`: each edge within RIVER_FILLET of the
 *  nearest weighs h² (h = 1 − gap/FILLET), the distance drops by up to FILLET/4 where two meet —
 *  continuous, order-free, and exactly the plain minimum wherever only one river is near. The
 *  per-edge weights are left in edgeWeight, the minimum in smoothMinDist. */
const edgeSmoothMin = (d: Float64Array, groups: number): void => {
  let dmin = Infinity;
  for (let g = 0; g < groups; g++) if (d[g] < dmin) dmin = d[g];
  let sum = 0;
  for (let g = 0; g < groups; g++) {
    const h = 1 - (d[g] - dmin) / RIVER_FILLET;
    edgeWeight[g] = h > 0 ? h * h : 0;
    sum += edgeWeight[g];
  }
  smoothMinDist = Math.max(0, dmin - (RIVER_FILLET / 4) * Math.min(1, sum - 1));
};

/** The same weights per RUN (runDist against the edges' minimum), into runWeight; returns their sum.
 *  An edge of one run weighs exactly its edgeWeight; the runs of an edge its unbuilt pieces split
 *  blend like two rivers, where the nearest run alone would jump between them. */
const runSmoothWeights = (runs: number, groups: number): number => {
  let dmin = Infinity;
  for (let g = 0; g < groups; g++) if (edgeDist[g] < dmin) dmin = edgeDist[g];
  let sum = 0;
  for (let r = 0; r < runs; r++) {
    const h = 1 - (runDist[r] - dmin) / RIVER_FILLET;
    runWeight[r] = h > 0 ? h * h : 0;
    sum += runWeight[r];
  }
  return sum;
};

const ensureFieldScratch = (groups: number, runs: number): void => {
  if (edgeDist.length < groups) {
    edgeDist = new Float64Array(groups * 2);
    edgeWeight = new Float64Array(groups * 2);
  }
  if (runDist.length < runs) {
    const size = runs * 2;
    runDist = new Float64Array(size);
    runWeight = new Float64Array(size);
    runPlain = new Float64Array(size);
    runPiece = new Int32Array(size);
    runT = new Float64Array(size);
    runFactor = new Float64Array(size);
    runSurface = new Float64Array(size);
    runShore = new Float64Array(size);
    runLevel = new Float64Array(size);
    runSideCos = new Float64Array(size);
    runOutCos = new Float64Array(size);
    runFootX = new Float64Array(size);
    runFootZ = new Float64Array(size);
  }
};

/** Sets riverSample to "no river in reach" — what a far visual-only vertex reports (computeVertexDataFar). */
export const noRiverSample = (): void => {
  riverSample.distance = Infinity;
  riverSample.factor = 1;
  riverSample.surface = NaN;
  riverSample.bedLimit = Infinity;
  riverSample.shore = Infinity;
  riverSample.level = NaN;
};

/** What the last fieldFromList found (riverSample's fields). */
let fieldDist = Infinity;
let fieldFactor = 1;
let fieldSurface = NaN;
let fieldShore = Infinity;
let fieldLevel = NaN;

/** One pass over a piece list at a warped point (qx, qz): per edge its nearest distance in factor-1
 *  units (edgeDist, the field's distance), per run its own, and what the run's PLAINLY nearest piece
 *  reads (run*). The width factor, the surface and the bed limit's station come from the plainly
 *  nearest piece, not the nearest by factor-1 distance: where the width varies along a river that one
 *  jumps between pieces of a run (to a pond's start from a piece upstream: 10.9u of surface at
 *  (-6300, 3511)), while the projection onto the run's collinear pieces moves continuously. Wherever
 *  the two are the same piece nothing differs. */
const scanPieces = (list: RiverCellList, qx: number, qz: number, forQuay: boolean): void => {
  ensureFieldScratch(list.groups, list.runs);
  edgeDist.fill(Infinity, 0, list.groups);
  runDist.fill(Infinity, 0, list.runs);
  runPlain.fill(Infinity, 0, list.runs);
  for (let j = 0; j < list.n; j++) {
    const g = list.group[j];
    const r = list.run[j];
    const sx = list.sx[j];
    const sz = list.sz[j];
    const dx = list.ex[j] - sx;
    const dz = list.ez[j] - sz;
    const l2 = dx * dx + dz * dz;
    let t = ((qx - sx) * dx + (qz - sz) * dz) / l2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const f = list.w0[j] + (list.w1[j] - list.w0[j]) * t;
    const ox = qx - (sx + dx * t);
    const oz = qz - (sz + dz * t);
    const real = Math.hypot(ox, oz);
    const d = real / f;
    if (d < edgeDist[g]) edgeDist[g] = d;
    if (d < runDist[r]) runDist[r] = d;
    if (real < runPlain[r]) {
      runPlain[r] = real;
      runFactor[r] = f;
      if (forQuay) {
        runFootX[r] = sx + dx * t;
        runFootZ[r] = sz + dz * t;
        continue;
      }
      runPiece[r] = j;
      runT[r] = t;
      runSurface[r] = list.h0[j] + (list.h1[j] - list.h0[j]) * t;
      runShore[r] = list.d0[j] + (list.d1[j] - list.d0[j]) * t;
      runLevel[r] = list.l0[j] + (list.l1[j] - list.l0[j]) * t;
      const l = Math.sqrt(l2);
      runSideCos[r] = real > 1e-9 ? (dx * oz - dz * ox) / (l * real) : 0;
      runOutCos[r] = real > 1e-9 ? Math.abs(ox * dx + oz * dz) / (l * real) : 0;
    }
  }
};

/** The river field of a piece list at a warped point, measured from a meandered query point
 *  (±RIVER_MEANDER_AMP) so a straight edge winds. Sets field* and the run scratch. */
const fieldFromList = (list: RiverCellList, px: number, pz: number): void => {
  fieldDist = Infinity;
  fieldFactor = 1;
  fieldSurface = NaN;
  fieldShore = Infinity;
  fieldLevel = NaN;
  if (list.n === 0) return;
  const qx = px + RIVER_MEANDER_AMP * simplex2(px / RIVER_MEANDER_SCALE, pz / RIVER_MEANDER_SCALE);
  const qz = pz + RIVER_MEANDER_AMP * simplex2(pz / RIVER_MEANDER_SCALE + 7.31, px / RIVER_MEANDER_SCALE - 3.17);
  scanPieces(list, qx, qz, false);
  edgeSmoothMin(edgeDist, list.groups);
  const sum = runSmoothWeights(list.runs, list.groups);
  let wf = 0;
  let ws = 0;
  let wd = 0;
  let wl = 0;
  for (let r = 0; r < list.runs; r++) {
    if (runWeight[r] === 0) continue;
    wf += runWeight[r] * runFactor[r];
    ws += runWeight[r] * runSurface[r];
    wd += runWeight[r] * runShore[r];
    wl += runWeight[r] * runLevel[r];
  }
  fieldDist = smoothMinDist;
  fieldFactor = wf / sum;
  fieldSurface = ws / sum;
  fieldShore = wd / sum;
  fieldLevel = wl / sum;
};

/** The bank at warped point (px, pz) as step 4 carves it: the terrain there (its own wall pass and
 *  shore) under the FULL river field of the point's own piece list — every river near it, confluences
 *  and ponds included (one river's profile alone missed the banks a second river shapes) — a mouth's
 *  lakebed only deepened. Sets bankSample: the field's distance, and the height, NaN where the point is
 *  in a river's water (the bed goes on there: it is that river's). Clobbers the wall-pass scratch and
 *  the edge scratch. */
export const bankSample = { height: NaN, distance: Infinity };
export const bankAt = (px: number, pz: number): void => {
  fieldFromList(riverCellListAt(px, pz), px, pz);
  const rv = domainConfig!.river;
  bankSample.distance = fieldDist;
  bankSample.height = NaN;
  if (!(fieldDist < rv.halfWidth + rv.bank)) return;
  const warped = { x: px, z: pz };
  const ctx = getBiomeContext(warped);
  accumulateWallFields(px, pz, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  const lake = lakeSurface(warped, ctx, ctx.zone);
  const world = unwarp(px, pz);
  const ground = blendedTerrainAt(world.x, world.z, ctx.zone, ctx);
  const carved = carveRiverChannel(ground, fieldDist, fieldSurface, fieldFactor);
  const h = carved + (Math.min(carved, ground) - carved) * riverMouthShare(ground, lake);
  if (!(h < fieldSurface && fieldDist < rv.halfWidth + rv.bank * 0.5)) bankSample.height = h;
};

// The runs a vertex's bed limit blends (riverFieldAt), copied out of the run scratch the marches clobber.
const limitPiece: RiverPiece[] = [];
let limitT = new Float64Array(16);
let limitSideCos = new Float64Array(16);
let limitOutCos = new Float64Array(16);
let limitWeight = new Float64Array(16);

/** Sets riverSample for a warped point: fieldFromList over the point's cell list. `besideCity`: the bed
 *  limit is wanted past the river's reach too (the city's quay rule paints the bed there). `bedLimit`
 *  false leaves the bed limit out (riverSample.bedLimit stays "none"), for a caller that reads only the
 *  distance, factor or surface: the bank marches were ~9% of a cold point's deck enumeration. */
export const riverFieldAt = (px: number, pz: number, besideCity = false, bedLimit = true): void => {
  noRiverSample();
  if (!riversEnabled) return;
  const list = riverCellList(px, pz);
  if (list.n === 0) return;
  fieldFromList(list, px, pz);
  riverSample.distance = fieldDist;
  riverSample.factor = fieldFactor;
  riverSample.surface = fieldSurface;
  riverSample.shore = fieldShore;
  riverSample.level = fieldLevel;
  if (!bedLimit) return;
  // The bed limit only matters on the bank (capRiverBed leaves anything RIVER_BED_CAP_FADE inside a limit
  // alone, and no limit lies inside the channel's half-width), and beside a city a little past it. The
  // marches read other cells' lists (riverCellListAt: never lastRiverCellList) and clobber the run
  // scratch: the runs are copied first.
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  if (!(fieldDist > rv.halfWidth - RIVER_BED_CAP_FADE)) return;
  if (!(fieldDist < reach || (besideCity && (fieldDist - reach - RIVER_BED_FULL_INSET) * fieldFactor < RIVER_BED_LIMIT_PAST))) return;
  let n = 0;
  let sum = 0;
  if (limitT.length < list.runs) {
    limitT = new Float64Array(list.runs * 2);
    limitSideCos = new Float64Array(list.runs * 2);
    limitOutCos = new Float64Array(list.runs * 2);
    limitWeight = new Float64Array(list.runs * 2);
  }
  for (let r = 0; r < list.runs; r++) {
    if (runWeight[r] === 0) continue;
    limitPiece[n] = list.pieces[runPiece[r]];
    limitT[n] = runT[r];
    limitSideCos[n] = runSideCos[r];
    limitOutCos[n] = runOutCos[r];
    limitWeight[n] = runWeight[r];
    sum += runWeight[r];
    n++;
  }
  let limit = 0;
  for (let i = 0; i < n; i++) limit += limitWeight[i] * bedLimitOfPiece(limitPiece[i], limitT[i], limitSideCos[i], limitOutCos[i]);
  riverSample.bedLimit = limit / sum;
};

/** riverSample.distance at a warped point (riverFieldAt), cached per exact point — and nothing else:
 *  riverSample and the last piece list are left as they were. For the decks' wet tests, which ask the
 *  same canonical road samples again from every overlapping window (MEASURED: 208k of a 3.6 km walk's
 *  973k field evaluations were such repeats). */
const riverDistanceCache = new PointCache(1 << 16);
export const riverDistanceAt = (px: number, pz: number): number => {
  let d = riverDistanceCache.get(px, pz);
  if (d !== undefined) return d;
  const s = riverSample;
  const saved = lastRiverCellList;
  const distance = s.distance, factor = s.factor, surface = s.surface, bedLimit = s.bedLimit, shore = s.shore, level = s.level;
  riverFieldAt(px, pz, false, false);
  d = s.distance;
  s.distance = distance;
  s.factor = factor;
  s.surface = surface;
  s.bedLimit = bedLimit;
  s.shore = shore;
  s.level = level;
  lastRiverCellList = saved;
  riverDistanceCache.set(px, pz, d);
  return d;
};

/** riverSample.surface as step 4 draws it at the warped point riverFieldAt last ran at: held up to a
 *  lake's level beside crisp land (lakes.ts riverSurfaceBesideCrispShore), so a deck clears the water
 *  that is drawn. Clobbers the wall-pass scratch and the shore state. */
export const drawnRiverSurface = (px: number, pz: number): number => {
  setShoreAt(px, pz);
  return riverSurfaceBesideCrispShore(riverSample.surface);
};

/** Sets riverQuay to "no river in reach". */
export const noRiverQuay = (): void => {
  riverQuay.distance = Infinity;
  riverQuay.factor = 1;
};

/** Sets riverQuay for a warped point: the river field from the STRAIGHT point, its factor and
 *  direction read off each run's plainly nearest piece (scanPieces). Only the city's quay (and the
 *  belt beside a river, step 5) reads it, after the vertex's riverFieldAt built the list. */
export const riverQuayAt = (px: number, pz: number): void => {
  noRiverQuay();
  if (!riversEnabled) return;
  const list = riverCellList(px, pz);
  if (list.n === 0) return;
  scanPieces(list, px, pz, true);
  edgeSmoothMin(edgeDist, list.groups);
  const sum = runSmoothWeights(list.runs, list.groups);
  let qf = 0;
  let ux = 0;
  let uz = 0;
  for (let r = 0; r < list.runs; r++) {
    if (runWeight[r] === 0) continue;
    qf += runWeight[r] * runFactor[r];
    const vx = runFootX[r] - px;
    const vz = runFootZ[r] - pz;
    const vl = Math.hypot(vx, vz);
    if (vl > 1e-9) {
      ux += (runWeight[r] * vx) / vl;
      uz += (runWeight[r] * vz) / vl;
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
  riverCellLists.clear();
  lastRiverCellList = null;
  riverDistanceCache.clear();
  clearRiverSurfaces();
  clearRiverBedLimits();
};
