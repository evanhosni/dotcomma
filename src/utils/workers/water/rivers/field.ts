/**
 * The PER-VERTEX river field (computeVertexData step 2; water/DECISIONS.md "The per-vertex field").
 *
 * Per 256u tile of warped space, the built pieces within the field's support, grouped into RUNS (an
 * edge's consecutive built pieces). The distance is measured from a gently MEANDERED query point and
 * NORMALIZED by the local width factor (factor-1 units, so the `river` config describes every river as
 * is): within one edge a plain minimum over its pieces (joints never notch), across edges a smooth
 * minimum (RIVER_FILLET), so confluences fillet. The width factor, the surface, the lake's wall distance
 * and level, the flow and the bed limit are read off each run's PLAINLY nearest piece — its projection
 * moves continuously along collinear pieces, where the nearest by factor-1 distance jumps wherever the
 * width varies — and weighted across runs by the same compact kernel.
 *
 * A pond is a DISC element of the same field (water/ponds/ places them): its own run and
 * edge slot, so it fillets into a river like a confluence, its distance normalized by its (blobbed)
 * waterline radius, its surface its level, its flow 0, its depth scaled by its kind.
 *
 * The QUAY (riverQuayAt) and riverStraight read the same pieces from the STRAIGHT point (the city's
 * quay curbs would wobble with the meander): the quay's distance is measured from the nearest FOOTPRINT,
 * so beside a narrow tip a wide piece downstream never reads nearer than it is.
 */

import { distanceToSegment, smoothMin } from "../../../math";
import { CellCache, PointCache, TileCache } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import { simplex2, unwarp } from "../../noise";
import type { RiverQuaySample } from "../../types";
import { blendedTerrainAt } from "../../vertexCompute";
import { getBiomeContext } from "../../voronoi";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights } from "../../zoneBlend";
import { riverWaterBand } from "../channel";
import { keepingVertex } from "../utils";
import { drawnRiverWater, holdRiverBesideQuays } from "../joins";
import { lakeSurface, shoreReach } from "../lakes";
import { pondDiscsIn } from "../ponds";
import type { FieldDisc } from "../types";
import { clearBedLimits, discBedLimit, marchingBedLimits, runBedLimit } from "./bedLimit";
import { RIVER_FILLET, RIVER_FLOW_BLEND, RIVER_MEANDER_AMP, RIVER_MEANDER_SCALE, pieceBuilt, riverKeepOff, riverMaxReach } from "./constants";
import { RIVER_FIELD_READ } from "../constants";
import { RIVERS, waterBodyDefaults } from "../params";
import type { WallShape } from "../types";
import { RIVERS_DEFAULTS } from "./params";
import { valleyBlendOver, widestValleyBlend } from "../valleys";
import { junctionEdges, pieceAt, riverPiecesIn } from "./network";
import { rawPondDiscsOf } from "./ponds";
import { climbedCodes } from "./summits";
import { type EdgeSurfaces, edgeBaseSurfaces, edgeSurfaces } from "./surface";
import type { RiverEdge, RiverJunction } from "./types";

const TILE = 256;

/** How far past a footprint the field answers (real units): the widest WALL reach mounted in this domain
 *  (a <Rivers> or <Pond> mount's, the base's defaults, RIVERS_DEFAULTS). Past RIVER_FIELD_READ a point reads
 *  only its walls and its gap (riverFieldAt); a valley wider than this reads the rest of its gap off the far
 *  field (farRiverGapAt). Found once per init (NaN: not yet). */
let wallRead = NaN;
export const widestWallReach = (): number => {
  if (Number.isNaN(wallRead)) {
    wallRead = Math.max(RIVER_FIELD_READ, RIVERS_DEFAULTS.wallReach, (waterBodyDefaults(RIVERS) as Partial<WallShape>).wallReach ?? 0);
    for (const body of domainConfig!.waterBodies) wallRead = Math.max(wallRead, (body.params as Partial<WallShape>).wallReach ?? 0);
  }
  return wallRead;
};


/** Its width toward unit (dx, dz) from its centre: the waterline wobbled smoothly all round — noise ON a
 *  circle, so there is no angle seam. The circle's circumference is `lobes` noise units (about `lobes`
 *  swells): at radius `lobes` a shore was ~19 spikes, at lobes/π a spring a starfish. */
export const discWidthToward = (disc: FieldDisc, dx: number, dz: number): number => {
  const k = disc.lobes / (2 * Math.PI);
  return disc.width * (1 + disc.amount * simplex2(dx * k + disc.phase, dz * k - disc.phase));
};

/** A tile's pieces, flat (warped): ends, widths, the run each belongs to and its index in its edge; then
 *  its discs, each a run and an edge slot of its own after the pieces'. */
interface FieldList {
  n: number;
  sx: Float64Array;
  sz: Float64Array;
  ex: Float64Array;
  ez: Float64Array;
  w0: Float64Array;
  w1: Float64Array;
  index: Int32Array;
  run: Int32Array;
  runs: { e: RiverEdge; edgeSlot: number; surfaces: EdgeSurfaces }[];
  edges: number;
  discs: FieldDisc[];
  /** The tile's corner (warped), and per CELL of it the pieces that can matter there (cellPieces). */
  x0: number;
  z0: number;
  cells: (Int32Array | undefined)[];
}


const buildList = (tx: number, tz: number): FieldList => {
  const x0 = tx * TILE;
  const z0 = tz * TILE;
  const pad = riverMaxReach() + widestWallReach() + RIVER_MEANDER_AMP;
  const pieces = riverPiecesIn(x0, z0, x0 + TILE, z0 + TILE, pad);
  const n = pieces.length;
  const list: FieldList = {
    n,
    sx: new Float64Array(n),
    sz: new Float64Array(n),
    ex: new Float64Array(n),
    ez: new Float64Array(n),
    w0: new Float64Array(n),
    w1: new Float64Array(n),
    index: new Int32Array(n),
    run: new Int32Array(n),
    runs: [],
    edges: 0,
    discs: [],
    x0,
    z0,
    cells: [],
  };
  let lastEdge: RiverEdge | null = null;
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    if (p.edge !== lastEdge) list.edges++;
    if (p.edge !== lastEdge || p.index !== pieces[i - 1].index + 1) list.runs.push({ e: p.edge, edgeSlot: list.edges - 1, surfaces: keepingVertex(() => edgeSurfaces(p.edge)) });
    lastEdge = p.edge;
    list.sx[i] = p.sx;
    list.sz[i] = p.sz;
    list.ex[i] = p.ex;
    list.ez[i] = p.ez;
    list.w0[i] = p.w0;
    list.w1[i] = p.w1;
    list.index[i] = p.index;
    list.run[i] = list.runs.length - 1;
  }
  // Enumerating ponds evaluates terrain (their spots and levels).
  list.discs = keepingVertex(() => fieldDiscsIn(x0, z0, x0 + TILE, z0 + TILE, pad));
  return list;
};

/** Discs a test stands in the field beside the placed ones (null: none). */
let injected: FieldDisc[] | null = null;
export const injectFieldDiscs = (discs: FieldDisc[] | null): void => {
  injected = discs;
  clearRiverField();
};
const fieldDiscsIn = (x0: number, z0: number, x1: number, z1: number, pad: number): FieldDisc[] => {
  const placed = pondDiscsIn(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
  if (!injected) return placed;
  return [...placed, ...injected.filter((d) => d.x > x0 - pad && d.x < x1 + pad && d.z > z0 - pad && d.z < z1 + pad)];
};
const runCount = (list: FieldList): number => list.runs.length + list.discs.length;

/** A tile's pieces are measured per CELL from only those that can still be, for SOME point of the cell, a
 *  run's plainly nearest, its lowest by factor-1 distance, or the nearest footprint (measure()): a piece
 *  whose nearest possible value there exceeds another's farthest never wins, so dropping it changes no
 *  minimum and no first-wins tie. */
const CELL = 32;
const CELLS = TILE / CELL;
/** Bound slack for the float difference between these box bounds and measure()'s hypot. */
const boundSlack = (ub: number): number => Math.abs(ub) * 1e-9 + 1e-6;
/** Bounds on a segment's distance from the points of a box: never under `lo`, and from every point at
 *  most `hi` (the box's farthest corner from the segment point nearest the box's centre). */
const box = { lo: 0, hi: 0 };
const segmentBoxBounds = (sx: number, sz: number, ex: number, ez: number, bx0: number, bz0: number, bx1: number, bz1: number): void => {
  const dx = ex - sx;
  const dz = ez - sz;
  const len2 = dx * dx + dz * dz;
  const mx = (bx0 + bx1) / 2;
  const mz = (bz0 + bz1) / 2;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((mx - sx) * dx + (mz - sz) * dz) / len2)) : 0;
  const px = sx + dx * t;
  const pz = sz + dz * t;
  const fx = Math.max(Math.abs(px - bx0), Math.abs(px - bx1));
  const fz = Math.max(Math.abs(pz - bz0), Math.abs(pz - bz1));
  box.hi = Math.sqrt(fx * fx + fz * fz);
  // Nearest: the box's distance to the segment's midpoint, less its half length.
  const ox = Math.max(bx0 - (sx + ex) / 2, 0, (sx + ex) / 2 - bx1);
  const oz = Math.max(bz0 - (sz + ez) / 2, 0, (sz + ez) / 2 - bz1);
  box.lo = Math.max(0, Math.sqrt(ox * ox + oz * oz) - Math.sqrt(len2) / 2);
};
const cellPieces = (list: FieldList, c: number): Int32Array => {
  const bx0 = list.x0 + (c % CELLS) * CELL;
  const bz0 = list.z0 + Math.floor(c / CELLS) * CELL;
  const keep = riverKeepOff();
  const n = list.n;
  const lo = new Float64Array(n);
  const nearestHi = new Float64Array(list.runs.length).fill(Infinity);
  const dnHi = new Float64Array(list.runs.length).fill(Infinity);
  let gapHi = Infinity;
  for (let i = 0; i < n; i++) {
    segmentBoxBounds(list.sx[i], list.sz[i], list.ex[i], list.ez[i], bx0, bz0, bx0 + CELL, bz0 + CELL);
    lo[i] = box.lo;
    const r = list.run[i];
    const wMin = Math.min(list.w0[i], list.w1[i]);
    nearestHi[r] = Math.min(nearestHi[r], box.hi);
    if (wMin > 0) dnHi[r] = Math.min(dnHi[r], box.hi / wMin);
    gapHi = Math.min(gapHi, box.hi - keep * wMin);
  }
  const kept: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = list.run[i];
    const wMax = Math.max(list.w0[i], list.w1[i]);
    const dx = list.ex[i] - list.sx[i];
    const dz = list.ez[i] - list.sz[i];
    const matters =
      !(dx * dx + dz * dz > 0) ||
      !(Math.min(list.w0[i], list.w1[i]) > 0) ||
      lo[i] <= nearestHi[r] + boundSlack(nearestHi[r]) ||
      lo[i] / wMax <= dnHi[r] + boundSlack(dnHi[r]) ||
      lo[i] - keep * wMax <= gapHi + boundSlack(gapHi);
    if (matters) kept.push(i);
  }
  return Int32Array.from(kept);
};
/** The pieces measure() reads at a query point: its cell's, or all where it lies off the tile (a
 *  meandered point near its edge). */
const piecesFor = (list: FieldList, qx: number, qz: number): Int32Array | null => {
  const cx = Math.floor((qx - list.x0) / CELL);
  const cz = Math.floor((qz - list.z0) / CELL);
  if (!(cx >= 0 && cz >= 0 && cx < CELLS && cz < CELLS)) return null;
  const c = cz * CELLS + cx;
  return list.cells[c] ?? (list.cells[c] = cellPieces(list, c));
};
const tiles = new TileCache<FieldList>(TILE, 4096, buildList);
/** The list the last field, quay or straight query read (riverListKey). */
let currentList: FieldList | null = null;
const listAt = (x: number, z: number): FieldList => (currentList = tiles.at(x, z));

// Per-run scratch of the last measure(): the run's factor-1 distance, its plainly nearest piece (list
// index), that piece's real distance and projection (clamped, and raw), and per edge slot the edge's distance.
let runDn = new Float64Array(16);
let runPiece = new Int32Array(16);
let runD = new Float64Array(16);
let runT = new Float64Array(16);
let runRawT = new Float64Array(16);
/** A disc run's width toward the query point. */
let runWidth = new Float64Array(16);
let edgeDn = new Float64Array(16);
/** The smallest real distance past a footprint, its piece, and that piece's nearest point. */
const gap = { d: Infinity, piece: -1, x: 0, z: 0 };
/** How far (factor-1) the last measure()'s confluence fillet pulled the combined distance below the
 *  nearest edge's: 0 away from a confluence. */
let filletDrop = 0;

/** Measures every run of `list` from (qx, qz) into the scratch; returns the combined factor-1 distance
 *  (two nearest edges by a smooth minimum). `discs` false: the river lines alone (the straight reads). */
const measure = (list: FieldList, qx: number, qz: number, discs = true): number => {
  const runs = discs ? runCount(list) : list.runs.length;
  const edges = list.edges + (discs ? list.discs.length : 0);
  if (runDn.length < runs) {
    runDn = new Float64Array(runs * 2);
    runPiece = new Int32Array(runs * 2);
    runD = new Float64Array(runs * 2);
    runT = new Float64Array(runs * 2);
    runRawT = new Float64Array(runs * 2);
    runWidth = new Float64Array(runs * 2);
  }
  if (edgeDn.length < edges) edgeDn = new Float64Array(edges * 2);
  runDn.fill(Infinity, 0, runs);
  edgeDn.fill(Infinity, 0, edges);
  const keep = riverKeepOff();
  gap.d = Infinity;
  let bestRun = -1;
  let bestRunD = Infinity;
  const cell = piecesFor(list, qx, qz);
  for (let c = 0, count = cell ? cell.length : list.n; c < count; c++) {
    const i = cell ? cell[c] : c;
    const r = list.run[i];
    if (r !== bestRun) {
      bestRun = r;
      bestRunD = Infinity;
    }
    const dx = list.ex[i] - list.sx[i];
    const dz = list.ez[i] - list.sz[i];
    const raw = ((qx - list.sx[i]) * dx + (qz - list.sz[i]) * dz) / (dx * dx + dz * dz);
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const px = list.sx[i] + dx * t;
    const pz = list.sz[i] + dz * t;
    const ox = qx - px;
    const oz = qz - pz;
    const d = Math.sqrt(ox * ox + oz * oz);
    const w = list.w0[i] + (list.w1[i] - list.w0[i]) * t;
    const dn = d / w;
    if (dn < runDn[r]) runDn[r] = dn;
    if (d < bestRunD) {
      bestRunD = d;
      runPiece[r] = i;
      runD[r] = d;
      runT[r] = t;
      runRawT[r] = raw;
    }
    if (d - keep * w < gap.d) {
      gap.d = d - keep * w;
      gap.piece = i;
      gap.x = px;
      gap.z = pz;
    }
  }
  let d1 = Infinity;
  let d2 = Infinity;
  for (let r = 0; r < list.runs.length; r++) {
    const slot = list.runs[r].edgeSlot;
    if (runDn[r] < edgeDn[slot]) edgeDn[slot] = runDn[r];
  }
  if (discs) {
    for (let k = 0; k < list.discs.length; k++) {
      const disc = list.discs[k];
      const ox = qx - disc.x;
      const oz = qz - disc.z;
      const d = Math.sqrt(ox * ox + oz * oz);
      const w = d > 1e-9 ? discWidthToward(disc, (qx - disc.x) / d, (qz - disc.z) / d) : disc.width;
      const r = list.runs.length + k;
      runDn[r] = edgeDn[list.edges + k] = d / w;
      runWidth[r] = w;
      runPiece[r] = -1;
      if (d - keep * w < gap.d) gap.d = d - keep * w;
    }
  }
  for (let s = 0; s < edges; s++) {
    if (edgeDn[s] < d1) {
      d2 = d1;
      d1 = edgeDn[s];
    } else if (edgeDn[s] < d2) d2 = edgeDn[s];
  }
  const combined = d2 < Infinity ? smoothMin(d1, d2, RIVER_FILLET) : d1;
  filletDrop = d1 - combined;
  return combined;
};
/** How soft (factor-1 units) the minimum the runs' bed limits meet by is. */
const BED_LIMIT_SOFTNESS = 2;
/** A run's weight against the nearest: h² with h = 1 − its excess over the fillet. */
const runWeight = (r: number, nearest: number): number => {
  const h = 1 - (runDn[r] - nearest) / RIVER_FILLET;
  return h > 0 ? h * h : 0;
};
const nearestRun = (list: FieldList, discs = true): number => {
  let m = Infinity;
  for (let r = 0, n = discs ? runCount(list) : list.runs.length; r < n; r++) if (runDn[r] < m) m = runDn[r];
  return m;
};

const NO_WALLS: readonly number[] = [];
/** What riverFieldAt last found: the factor-1 distance (Infinity out of reach), the width factor, the
 *  water surface, the bed limit (factor-1: past it no bed is painted; Infinity = none), the lake's
 *  signed wall distance and level at the centerline (Infinity / NaN: no lake), the flow (world), the
 *  channel's depth scale (1 on a river, a disc's kind's depth), the water-body slot of the disc
 *  whose water this mostly is (−1: a river's, which the biome it runs through resolves), the heaviest
 *  disc's slot and the discs' share of the kernel (`pondBody`, `pondShare`: what blends a bank's relief), and
 *  per river run and pond in reach its water, how far past its water band the point lies (real units) and
 *  its body (a pond's slot; −1 a river's), as triples: what each wall is cut from (water/channel
 *  carveRiverWall), and the real distance past the nearest footprint (`gap`, Infinity past widestWallReach:
 *  the valleys'). */
export const riverSample = { distance: Infinity, factor: 1, surface: NaN, bedLimit: Infinity, shore: Infinity, level: NaN, flowX: 0, flowZ: 0, depth: 1, body: -1, pondBody: -1, pondShare: 0, walls: NO_WALLS as readonly number[], gap: Infinity };
export const noRiverSample = (): void => {
  riverSample.distance = Infinity;
  riverSample.factor = 1;
  riverSample.surface = NaN;
  riverSample.bedLimit = Infinity;
  riverSample.shore = Infinity;
  riverSample.level = NaN;
  riverSample.flowX = 0;
  riverSample.flowZ = 0;
  riverSample.depth = 1;
  riverSample.body = -1;
  riverSample.pondBody = -1;
  riverSample.pondShare = 0;
  riverSample.walls = NO_WALLS;
  riverSample.gap = Infinity;
};

/** The MEANDERED query point of a warped point (into `meandered`): what every distance of the field is
 *  measured from. `unmeander` inverts it (a few fixed-point steps; the wiggle is slow and small). */
export const meandered = { x: 0, z: 0 };
const meanderAt = (px: number, pz: number): void => {
  meandered.x = px + RIVER_MEANDER_AMP * simplex2(px / RIVER_MEANDER_SCALE, pz / RIVER_MEANDER_SCALE);
  meandered.z = pz + RIVER_MEANDER_AMP * simplex2(pz / RIVER_MEANDER_SCALE + 7.31, px / RIVER_MEANDER_SCALE - 3.17);
};
export const unmeander = (qx: number, qz: number): void => {
  let px = qx;
  let pz = qz;
  for (let k = 0; k < 4; k++) {
    meanderAt(px, pz);
    px += qx - meandered.x;
    pz += qz - meandered.z;
  }
  meandered.x = px;
  meandered.z = pz;
};

/** The flow down piece i of an edge (its joints' surfaces): along the edge toward the lower end, its
 *  strength growing with the grade up to the steepest its rules build a river on (`maxGrade`). */
const flow = { x: 0, z: 0 };
const pieceFlow = (e: RiverEdge, s: EdgeSurfaces, i: number, weight: number): void => {
  const drop = s.capped[i] - s.capped[i + 1];
  const grade = Math.abs(drop) / (e.len / e.count);
  const strength = (0.3 + 0.7 * Math.sqrt(Math.min(1, grade / e.rules.maxGrade))) * (drop < 0 ? -1 : 1) * weight;
  flow.x += e.ux * strength;
  flow.z += e.uz * strength;
};

/** The kernel sums of one riverFieldAt over the runs and discs that weigh (runWeight): their weight, the
 *  width factor, surface and depth, the lake's wall distance and level where a run has one, the discs'
 *  share, and the heaviest disc's body. */
const kernel = { sum: 0, factor: 0, surface: 0, shore: 0, level: 0, levelSum: 0, discSum: 0, depth: 0, body: -1, bodyWeight: 0 };

/** Discs: their own width, level and depth; no flow, lake or bed limit. */
const weighDiscs = (list: FieldList, nearest: number): void => {
  for (let k = 0; k < list.discs.length; k++) {
    const r = list.runs.length + k;
    const w = runWeight(r, nearest);
    if (w <= 0) continue;
    const disc = list.discs[k];
    kernel.sum += w;
    kernel.discSum += w;
    kernel.factor += w * runWidth[r];
    kernel.surface += w * disc.level;
    kernel.depth += w * disc.depth;
    if (w > kernel.bodyWeight) {
      kernel.bodyWeight = w;
      kernel.body = disc.body;
    }
  }
};

/** Runs: each off its plainly nearest piece — width factor, surface, the lake beside it, and the flow. */
const weighRuns = (list: FieldList, nearest: number): void => {
  for (let r = 0; r < list.runs.length; r++) {
    const w = runWeight(r, nearest);
    if (w <= 0) continue;
    const j = runPiece[r];
    const t = runT[r];
    const i = list.index[j];
    const { e, surfaces: s } = list.runs[r];
    kernel.sum += w;
    kernel.factor += w * (list.w0[j] + (list.w1[j] - list.w0[j]) * t);
    kernel.surface += w * (s.capped[i] + (s.capped[i + 1] - s.capped[i]) * t);
    const sh0 = s.shore[i];
    const sh1 = s.shore[i + 1];
    if (sh0 < Infinity || sh1 < Infinity) {
      const reach = shoreReach();
      kernel.shore += w * (Math.min(sh0, reach) + (Math.min(sh1, reach) - Math.min(sh0, reach)) * t);
      const l0 = Number.isNaN(s.level[i]) ? s.level[i + 1] : s.level[i];
      const l1 = Number.isNaN(s.level[i + 1]) ? s.level[i] : s.level[i + 1];
      kernel.level += w * (l0 + (l1 - l0) * t);
      kernel.levelSum += w;
    }
    // The flow cross-fades over RIVER_FLOW_BLEND each side of a joint with a built neighbour.
    const L = e.len / e.count;
    const toStart = t * L;
    const toEnd = (1 - t) * L;
    const prev = toStart < RIVER_FLOW_BLEND && j > 0 && list.run[j - 1] === r ? 0.5 * (1 - toStart / RIVER_FLOW_BLEND) : 0;
    const next = toEnd < RIVER_FLOW_BLEND && j + 1 < list.n && list.run[j + 1] === r ? 0.5 * (1 - toEnd / RIVER_FLOW_BLEND) : 0;
    pieceFlow(e, s, i, w * (1 - prev - next));
    if (prev > 0) pieceFlow(e, s, i - 1, w * prev);
    if (next > 0) pieceFlow(e, s, i + 1, w * next);
  }
};

/** Every run's wall, its weight in the kernel or not, from its PLAINLY nearest point: its water there and its
 *  real distance past the band there. Along a run's collinear pieces both move continuously, and the
 *  distance never reads under the gap the field's support is cut at, so each wall eases out before its run
 *  leaves the support and their minimum never steps (water/DECISIONS.md "Cliffs at the field's edge"). And
 *  every pond's, from its level, past its (blobbed) band toward the point: the ground makes room for it as for
 *  a river, so a pond in a notch sits in a bowl instead of between walls. Read before a bed limit's march
 *  clobbers the scratch. */
const wallsOf = (list: FieldList): number[] => {
  const band = riverWaterBand(domainConfig!.river);
  const walls: number[] = [];
  for (let r = 0; r < list.runs.length; r++) {
    const j = runPiece[r];
    const t = runT[r];
    const i = list.index[j];
    const s = list.runs[r].surfaces;
    walls.push(s.capped[i] + (s.capped[i + 1] - s.capped[i]) * t, Math.max(0, runD[r] - band * (list.w0[j] + (list.w1[j] - list.w0[j]) * t)), -1);
  }
  for (let k = 0; k < list.discs.length; k++) {
    const r = list.runs.length + k;
    walls.push(list.discs[k].level, Math.max(0, (runDn[r] - band) * runWidth[r]), list.discs[k].body);
  }
  return walls;
};

/** The bed limit (factor-1) at the meandered point (qx, qz): the weighing runs' and discs' marched limits,
 *  met by a kernel-weighted SOFT MINIMUM (an average let a confluence's flat-banked run carry the bed past
 *  the other's steep bank onto the terrace above it). Marching evaluates whole vertices, which clobbers
 *  this module's scratch: what each needs is read off it first. */
const bedLimitAt = (list: FieldList, nearest: number, qx: number, qz: number): number => {
  const limits: number[] = [];
  for (let r = 0; r < list.runs.length; r++) {
    const w = runWeight(r, nearest);
    if (w > 0) limits.push(r, runPiece[r], runT[r], runRawT[r], w);
  }
  const discLimits: number[] = [];
  for (let k = 0; k < list.discs.length; k++) {
    const w = runWeight(list.runs.length + k, nearest);
    if (w > 0) discLimits.push(k, w);
  }
  let lsum = 0;
  let wsum = 0;
  for (let k = 0; k < limits.length; k += 5) {
    const run = list.runs[limits[k]];
    const j = limits[k + 1];
    const first = j === 0 || list.run[j - 1] !== limits[k];
    const last = j + 1 === list.n || list.run[j + 1] !== limits[k];
    lsum += limits[k + 4] * Math.exp(-runBedLimit(run.e, list.index[j], limits[k + 2], limits[k + 3], first, last, qx, qz) / BED_LIMIT_SOFTNESS);
    wsum += limits[k + 4];
  }
  // A pond's bed is marched round it like a river's along it: past P7 a river's pond end was a disc with
  // no limit, and its bed painted 150u up the rock above it wherever the slope eased.
  for (let k = 0; k < discLimits.length; k += 2) {
    const disc = list.discs[discLimits[k]];
    lsum += discLimits[k + 1] * Math.exp(-discBedLimit(disc, discWidthToward, qx, qz) / BED_LIMIT_SOFTNESS);
    wsum += discLimits[k + 1];
  }
  return wsum > 0 ? -BED_LIMIT_SOFTNESS * Math.log(lsum / wsum) : Infinity;
};

/** The river field at a warped point into riverSample. `ownBanks`: no bed limit is computed (a biome
 *  that keeps its own banks paints its own bed edge). `bedLimit` false: none at all (every caller but the
 *  terrain itself). `bedLimitPast`: the limit is only computed within this many real units past the reach
 *  (outside it riverSample.bedLimit is Infinity) — step 4 caps only a bed distance inside the reach, and a
 *  vertex's bed distance undercuts its river distance only beside a city's quay. */
export const riverFieldAt = (px: number, pz: number, ownBanks = false, bedLimit = true, bedLimitPast = Infinity): void => {
  const list = listAt(px, pz);
  if (list.n === 0 && list.discs.length === 0) return noRiverSample();
  meanderAt(px, pz);
  const qx = meandered.x;
  const qz = meandered.z;
  const distance = measure(list, qx, qz);
  // (Read now: a bed limit's march below re-enters this module.)
  const footprintGap = gap.d;
  if (footprintGap > widestWallReach()) return noRiverSample();
  if (footprintGap > RIVER_FIELD_READ) {
    // Past the field's support only the walls, easing out, and the valleys' distance still reach.
    noRiverSample();
    riverSample.walls = wallsOf(list);
    riverSample.gap = footprintGap;
    return;
  }
  const nearest = nearestRun(list);
  kernel.sum = kernel.factor = kernel.surface = kernel.shore = kernel.level = kernel.levelSum = kernel.discSum = kernel.depth = kernel.bodyWeight = 0;
  kernel.body = -1;
  flow.x = 0;
  flow.z = 0;
  weighDiscs(list, nearest);
  weighRuns(list, nearest);
  const walls = wallsOf(list);
  // Read off the kernel before a bed limit's march recurses into this function.
  const { sum, factor, surface, shore, level, levelSum, discSum, depth, body } = kernel;
  const flowX = flow.x / sum;
  const flowZ = flow.z / sum;
  const keep = riverKeepOff();
  const wantLimit =
    bedLimit && !ownBanks && marchingBedLimits === 0 && (distance < keep || (bedLimitPast > 0 && (distance - keep) * (factor / sum) < bedLimitPast + 1));
  const limit = wantLimit ? bedLimitAt(list, nearest, qx, qz) : Infinity;
  riverSample.distance = distance;
  riverSample.factor = factor / sum;
  riverSample.surface = surface / sum;
  riverSample.bedLimit = limit;
  // A run (or disc) with no lake in reach counts as shoreReach() from one, as a joint does inside a run: an
  // average over the known runs alone jumped to a lake's distance the moment one entered the kernel, and
  // the merge with it (13u steps beside desert ponds).
  riverSample.shore = levelSum > 0 ? (shore + (sum - levelSum) * shoreReach()) / sum : Infinity;
  riverSample.level = levelSum > 0 ? level / levelSum : NaN;
  riverSample.flowX = flowX;
  riverSample.flowZ = flowZ;
  // Exactly 1 with no disc in reach: the field is bit-identical to one without them.
  riverSample.depth = discSum > 0 ? (depth + sum - discSum) / sum : 1;
  riverSample.body = discSum * 2 > sum ? body : -1;
  riverSample.pondBody = body;
  riverSample.pondShare = discSum / sum;
  riverSample.walls = walls;
  riverSample.gap = footprintGap;
};

/** The real distance past the nearest river or pond footprint at a warped point, from the meandered point as
 *  riverFieldAt measures it (Infinity past widestWallReach): what the valleys grow with. Leaves riverSample
 *  and the last query's list alone. */
export const riverGapAt = (px: number, pz: number): number => {
  const list = tiles.at(px, pz);
  if (list.n === 0 && list.discs.length === 0) return Infinity;
  meanderAt(px, pz);
  measure(list, meandered.x, meandered.z);
  return gap.d > widestWallReach() ? Infinity : gap.d;
};

/**
 * THE FAR FIELD (a far LOD blind to the river field: LODLevel.carvesRivers false, LOD4's 210u spacing):
 * what the water does to the SHAPE of the land, coarsely — every river's walls and the valleys' gap — so
 * the far mountains stand where the near ones do (without it LOD4 stood up to ~600u over LOD1–3: the full
 * valley lift and no wall cut; water/DECISIONS.md "The far LODs keep the water's shape"). From the
 * network's RAW pieces (before the road layer, whose freeway routing was most of the cost of the real field
 * at that range), each at its junctions' width and its edge's base surface (edgeBaseSurfaces), and the ponds
 * its raw stretches end in and climb to (rivers/ponds.ts rawPondDiscsOf), measured from the straight point;
 * no channel, water, bed or quay (none resolves at that spacing), no standalone or mid-river pond.
 */
const FAR_TILE = 512;
interface FarList {
  n: number;
  /** Per element (a piece, or a pond's disc as a zero-length piece): ends, widths and surfaces at its two
   *  ends, its wall's body (−1: a river's); and its run (an edge's consecutive pieces; a disc its own). */
  p: Float64Array;
  run: Int32Array;
  /** How far past a footprint it answers (real units): the widest wall reach, or the widest valley blend
   *  any point of the tile can have (../valleys valleyBlendOver) — per tile, so the desert's 2500u blend
   *  widens only the reads near it. */
  outer: number;
}
const FAR_STRIDE = 9;
/** Whether a raw river leaves junction j other than along edge e. */
const rawGoesOn = (e: RiverEdge, j: RiverJunction): boolean => junctionEdges(j).some((f) => f.key !== e.key && pieceBuilt(climbedCodes(f)[pieceAt(f, j)]));
const farDiscs = new WeakMap<RiverEdge, FieldDisc[]>();
const farDiscsOf = (e: RiverEdge): FieldDisc[] => {
  let discs = farDiscs.get(e);
  if (!discs) farDiscs.set(e, (discs = rawPondDiscsOf(e, (j) => rawGoesOn(e, j), edgeBaseSurfaces(e))));
  return discs;
};
const buildFarList = (tx: number, tz: number): FarList => {
  const x0 = tx * FAR_TILE;
  const z0 = tz * FAR_TILE;
  return keepingVertex(() => {
    const outer = Math.max(widestWallReach(), valleyBlendOver(x0, z0, x0 + FAR_TILE, z0 + FAR_TILE));
    const pad = riverMaxReach() + outer;
    const pieces = riverPiecesIn(x0, z0, x0 + FAR_TILE, z0 + FAR_TILE, pad, true);
    const discs: FieldDisc[] = [];
    const edges = new Set<RiverEdge>();
    for (const { edge } of pieces) edges.add(edge);
    for (const e of edges) for (const d of farDiscsOf(e)) if (d.x > x0 - pad && d.x < x0 + FAR_TILE + pad && d.z > z0 - pad && d.z < z0 + FAR_TILE + pad && !discs.includes(d)) discs.push(d);
    const n = pieces.length + discs.length;
    const p = new Float64Array(n * FAR_STRIDE);
    const run = new Int32Array(n);
    let runs = -1;
    for (let i = 0; i < pieces.length; i++) {
      const { edge: e, index: k } = pieces[i];
      if (i === 0 || e !== pieces[i - 1].edge || k !== pieces[i - 1].index + 1) runs++;
      run[i] = runs;
      const s = edgeBaseSurfaces(e);
      const width = (j: number) => e.a.width + ((e.b.width - e.a.width) * j) / e.count;
      p.set([pieces[i].sx, pieces[i].sz, pieces[i].ex, pieces[i].ez, width(k), width(k + 1), s[k], s[k + 1], -1], i * FAR_STRIDE);
    }
    discs.forEach((d, k) => {
      run[pieces.length + k] = ++runs;
      p.set([d.x, d.z, d.x, d.z, d.width, d.width, d.level, d.level, d.body], (pieces.length + k) * FAR_STRIDE);
    });
    return { n, p, run, outer };
  });
};
const farTiles = new TileCache<FarList>(FAR_TILE, 1024, buildFarList);

/** The far field at a warped point into riverSample: its walls (one per run, off its plainly nearest
 *  piece, as riverFieldAt's) and its gap; everything else as noRiverSample. */
export const farRiverFieldAt = (px: number, pz: number): void => {
  noRiverSample();
  const { n, p, run, outer } = farTiles.at(px, pz);
  const keep = riverKeepOff();
  const band = riverWaterBand(domainConfig!.river);
  const walls: number[] = [];
  let footprintGap = Infinity;
  let current = -1;
  let nearest = Infinity;
  let surface = 0;
  let width = 1;
  let body = -1;
  const wall = () => {
    const past = Math.max(0, nearest - band * width);
    if (current >= 0 && past < outer) walls.push(surface, past, body);
  };
  for (let i = 0; i < n; i++) {
    if (run[i] !== current) {
      wall();
      current = run[i];
      nearest = Infinity;
    }
    const o = i * FAR_STRIDE;
    const dx = p[o + 2] - p[o];
    const dz = p[o + 3] - p[o + 1];
    const len2 = dx * dx + dz * dz;
    const raw = len2 > 0 ? ((px - p[o]) * dx + (pz - p[o + 1]) * dz) / len2 : 0;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const ox = px - p[o] - dx * t;
    const oz = pz - p[o + 1] - dz * t;
    const d = Math.sqrt(ox * ox + oz * oz);
    const w = p[o + 4] + (p[o + 5] - p[o + 4]) * t;
    if (d - keep * w < footprintGap) footprintGap = d - keep * w;
    if (d < nearest) {
      nearest = d;
      width = w;
      surface = p[o + 6] + (p[o + 7] - p[o + 6]) * t;
      body = p[o + 8];
    }
  }
  wall();
  if (footprintGap > outer) return;
  riverSample.walls = walls;
  riverSample.gap = footprintGap;
};

/** The far field's gap at a warped point (real units past the nearest raw footprint; Infinity past its
 *  tile's read). */
const farGapAt = (px: number, pz: number): number => {
  const { n, p, outer } = farTiles.at(px, pz);
  const keep = riverKeepOff();
  let footprintGap = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * FAR_STRIDE;
    const dx = p[o + 2] - p[o];
    const dz = p[o + 3] - p[o + 1];
    const len2 = dx * dx + dz * dz;
    const raw = len2 > 0 ? ((px - p[o]) * dx + (pz - p[o + 1]) * dz) / len2 : 0;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const ox = px - p[o] - dx * t;
    const oz = pz - p[o + 1] - dz * t;
    const d = Math.sqrt(ox * ox + oz * oz) - keep * (p[o + 4] + (p[o + 5] - p[o + 4]) * t);
    if (d < footprintGap) footprintGap = d;
  }
  return footprintGap > outer ? Infinity : footprintGap;
};
/** The far field's gap on a lattice of FAR_GAP_STEP (warped), interpolated bilinearly: what a valley wider
 *  than the walls reads past widestWallReach (../valleys). Continuous and cheap a vertex — the far field's
 *  raw pieces are a fraction of the built field's cost to enumerate, and a vertex reads four cached nodes.
 *  Capped at the widest valley blend (a node past its tile's read is Infinity, and no lift reads further). */
const FAR_GAP_STEP = 32;
const farGapNodes = new CellCache<number>(1 << 16);
const farGapNode = (i: number, j: number): number => {
  let g = farGapNodes.get(i, j);
  if (g === undefined) {
    g = Math.min(farGapAt(i * FAR_GAP_STEP, j * FAR_GAP_STEP), widestValleyBlend());
    farGapNodes.makeRoom();
    farGapNodes.set(i, j, g);
  }
  return g;
};
/** The last lattice cell read (a chunk's vertices walk one cell many times): its corner and four nodes. */
const farGapCell = { i: NaN, j: NaN, g00: 0, g10: 0, g01: 0, g11: 0 };
export const farRiverGapAt = (px: number, pz: number): number => {
  const fx = px / FAR_GAP_STEP;
  const fz = pz / FAR_GAP_STEP;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const c = farGapCell;
  if (i !== c.i || j !== c.j) {
    // Read into locals first: a node's first read builds a far tile, whose terrain probes re-enter here.
    const g00 = farGapNode(i, j);
    const g10 = farGapNode(i + 1, j);
    const g01 = farGapNode(i, j + 1);
    const g11 = farGapNode(i + 1, j + 1);
    c.g00 = g00;
    c.g10 = g10;
    c.g01 = g01;
    c.g11 = g11;
    c.i = i;
    c.j = j;
  }
  const tx = fx - i;
  const a = c.g00 + (c.g10 - c.g00) * tx;
  const b = c.g01 + (c.g11 - c.g01) * tx;
  return a + (b - a) * (fz - j);
};

/** The field from the STRAIGHT point: the real distance past the nearest footprint (Infinity out of the
 *  field's support), the factor weighted like riverFieldAt's, and the run of the nearest footprint. */
const straight = (px: number, pz: number): FieldList | null => {
  const list = listAt(px, pz);
  if (list.n === 0) return null;
  measure(list, px, pz, false);
  return gap.d > RIVER_FIELD_READ ? null : list;
};
const straightFactor = (list: FieldList): number => {
  const nearest = nearestRun(list, false);
  let sum = 0;
  let factor = 0;
  for (let r = 0; r < list.runs.length; r++) {
    const w = runWeight(r, nearest);
    if (w <= 0) continue;
    const j = runPiece[r];
    sum += w;
    factor += w * (list.w0[j] + (list.w1[j] - list.w0[j]) * runT[r]);
  }
  return factor / sum;
};

/** The quay's read of the river at a warped point (riverQuayAt): what the city's quay roads follow. */
export const riverQuay: RiverQuaySample = { distance: Infinity, factor: 1, dirX: 0, dirZ: 0 };
export const noRiverQuay = (): void => {
  riverQuay.distance = Infinity;
  riverQuay.factor = 1;
  riverQuay.dirX = 0;
  riverQuay.dirZ = 0;
};
/** The real distance from the nearest river FOOTPRINT plus the footprint's offset at the quay's own
 *  factor (so `distance − (halfWidth + bank) × factor` is the real gap to the bank), and the unit
 *  direction toward the river. */
export const riverQuayAt = (px: number, pz: number): void => {
  const list = straight(px, pz);
  if (!list) return noRiverQuay();
  const factor = straightFactor(list);
  const d = Math.hypot(gap.x - px, gap.z - pz);
  // The junction fillet's drop is kept, so a quay rounds a confluence like the water does.
  riverQuay.distance = Math.max(0, gap.d + (riverKeepOff() - filletDrop) * factor);
  riverQuay.factor = factor;
  if (d > 1e-9) {
    riverQuay.dirX = (gap.x - px) / d;
    riverQuay.dirZ = (gap.z - pz) / d;
  } else {
    const e = list.runs[list.run[gap.piece]].e;
    riverQuay.dirX = -e.uz;
    riverQuay.dirZ = e.ux;
  }
};

/** The river beside a warped point from its STRAIGHT position: the real distance to the nearest
 *  centerline (Infinity: none in reach), the width factor, and the river's direction there. */
export const riverStraight = { distance: Infinity, factor: 1, dirX: 1, dirZ: 0 };
export const riverStraightNear = (px: number, pz: number): void => {
  const list = straight(px, pz);
  riverStraight.distance = Infinity;
  if (!list) return;
  let best = Infinity;
  let bestRun = 0;
  for (let r = 0; r < list.runs.length; r++) {
    const j = runPiece[r];
    const dx = list.ex[j] - list.sx[j];
    const dz = list.ez[j] - list.sz[j];
    const d = Math.hypot(px - list.sx[j] - dx * runT[r], pz - list.sz[j] - dz * runT[r]);
    if (d < best) {
      best = d;
      bestRun = r;
    }
  }
  const j = runPiece[bestRun];
  const e = list.runs[bestRun].e;
  riverStraight.distance = best;
  riverStraight.factor = list.w0[j] + (list.w1[j] - list.w0[j]) * runT[bestRun];
  riverStraight.dirX = e.ux;
  riverStraight.dirZ = e.uz;
};

/** The identity of the piece list the last query read (a cache key for what depends on it). */
export const riverListKey = (): unknown => currentList;
/** Whether a warped segment comes within `reach` × a piece's width + `pad` (real units) of a river in
 *  the last query's list. */
export const riverListNearSegment = (sx: number, sz: number, ex: number, ez: number, reach: number, pad: number): boolean => {
  const list = currentList;
  if (!list) return false;
  for (let i = 0; i < list.n; i++) {
    const r = reach * Math.max(list.w0[i], list.w1[i]) + pad + RIVER_MEANDER_AMP;
    if (Math.max(sx, ex) < Math.min(list.sx[i], list.ex[i]) - r || Math.min(sx, ex) > Math.max(list.sx[i], list.ex[i]) + r) continue;
    if (Math.max(sz, ez) < Math.min(list.sz[i], list.ez[i]) - r || Math.min(sz, ez) > Math.max(list.sz[i], list.ez[i]) + r) continue;
    if (segmentsApart(sx, sz, ex, ez, list.sx[i], list.sz[i], list.ex[i], list.ez[i]) < r) return true;
  }
  return false;
};
const segmentsApart = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number => {
  const cross = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = cross(ax, az, bx, bz, cx, cz);
  const d2 = cross(ax, az, bx, bz, dx, dz);
  const d3 = cross(cx, cz, dx, dz, ax, az);
  const d4 = cross(cx, cz, dx, dz, bx, bz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(distanceToSegment(ax, az, cx, cz, dx, dz), distanceToSegment(bx, bz, cx, cz, dx, dz), distanceToSegment(cx, cz, ax, az, bx, bz), distanceToSegment(dx, dz, ax, az, bx, bz));
};

/** The river surface as the terrain draws it at a warped point (NaN off every river): held up at a crisp
 *  shore, and brought down onto a lake's level over a mouth. */
export const drawnRiverSurface = (x: number, z: number): number => {
  riverFieldAt(x, z, false, false);
  if (!(riverSample.distance < Infinity)) return NaN;
  const surface = riverSample.surface;
  return keepingVertex(() => {
    const ctx = getBiomeContext({ x, z });
    accumulateWallFields(x, z, ctx.zoneWalls, ctx.zone);
    combineZoneWeights(zoneWeights, zoneFinal);
    const lake = lakeSurface(ctx.warped, ctx, ctx.zone);
    const w = unwarp(x, z);
    const ground = blendedTerrainAt(w.x, w.z, ctx.zone, ctx, false);
    return drawnRiverWater(holdRiverBesideQuays(surface), ground, lake);
  });
};

/** The factor-1 river distance alone at a warped point (cached: road and deck probes ask again and again). */
const distances = new PointCache(1 << 16);
export const riverDistanceAt = (x: number, z: number): number => {
  let d = distances.get(x, z);
  if (d === undefined) {
    riverFieldAt(x, z, false, false);
    d = riverSample.distance;
    distances.set(x, z, d);
  }
  return d;
};

export const clearRiverField = (): void => {
  wallRead = NaN;
  tiles.clear();
  farTiles.clear();
  farGapNodes.clear();
  farGapCell.i = farGapCell.j = NaN;
  distances.clear();
  currentList = null;
  clearBedLimits();
};
