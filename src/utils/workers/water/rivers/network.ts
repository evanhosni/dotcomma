/**
 * THE RIVER NETWORK (CLAUDE.md "Rivers", water/DECISIONS.md). Rivers are the edges of their OWN
 * voronoi grid (RIVER_GRID_SIZE, shifted), independent of biomes, regions and roads: a pure function
 * of seed and position, so every chunk, worker and the server agree by construction.
 *
 * An edge of the grid carries a river by a seeded roll against the `<Rivers chance>` of the biome
 * under its midpoint (its own mount, else its region's) — or, dropped by its roll, where it would JOIN a
 * river END to another river (one junction holds exactly one rolled river, the other one or two) across a
 * gap the gorge rule cuts. It is cut into pieces of at most RIVER_PIECE_LENGTH, and each piece is decided in
 * LAYERS, each cached on the edge and each a pure function of the edge and its junctions:
 *   1. pieceRules.ts — water, high ground and pond blobs on the edge alone; gap fill; gorges through
 *      high ground (in the edge, and at each junction from its edges' own layer); then summits.ts — the
 *      gaps the gorges left between two waters, climbed to a pond on top where a <Pond summit> rolls;
 *   2. roadLayer.ts — the road wins: pieces under a road along the river or an undeckable wet stretch
 *      give way, and no river end stays under a road;
 *   3. here — the end shapes (mouth, pond, round, blunt), the ponds at the ends (ponds.ts) and the width at
 *      every joint, and the built pieces everything else reads (the field, the bridges, the city).
 * A junction's width factor — jittered, × its <Rivers width>, widened toward the lakes near it (../joins
 * riverWideningAt) — is shared by every river meeting there; the factor varies linearly along an edge,
 * times its end shapes.
 */

import Delaunator from "delaunator";
import { seedRand, smoothstep } from "../../../math";
import type { PointXZ } from "../../../math/types";
import { CellCache, dropOldestHalf } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import type { DomainConfig } from "../../types";
import { getRegionGrid, nearestCell, zoneAtWarped } from "../../voronoi";
import {
  PIECE_ROAD,
  PIECE_WATER,
  RIVER_POND_FACTOR,
  RIVER_POND_LENGTH,
  RIVER_SHAPED_MAX,
  RIVER_GRID_SHIFT_X,
  RIVER_GRID_SHIFT_Z,
  RIVER_GRID_SIZE,
  RIVER_PIECE_LENGTH,
  RIVER_WIDTH_JITTER,
  RIVER_WIDTH_MAX,
  RIVER_WINDOW_CELLS,
  pieceBuilt,
} from "./constants";
import { biomeRiverChance, clearRiverShapes, riversIn } from "./params";
import { riverWideningAt } from "../joins";
import type { PondMount } from "../ponds/params";
import { clearPieceRules, riseOverWaterLine } from "./pieceRules";
import { endPondsOf, riverEndPondOf } from "./ponds";
import { finalCodes, junctionEndKind } from "./roadLayer";
import { clearSummits, climbTaper, climbedCodes } from "./summits";
import { clearRiverSurfaces } from "./surface";
import { WATER_BELOW_GROUND } from "../constants";
import { waterGroundAt } from "../utils";
import type { RiverEdge, RiverJunction, RiverPiece } from "./types";
import { isLakeBiome } from "../lakes/params";

/** Whether any region or biome of the domain mounts <Rivers>: none (home, 404) means no river anywhere. */
export let riversEnabled = false;

const sites = new CellCache<PointXZ>(16384);
const siteAt = (ix: number, iz: number): PointXZ => {
  let s = sites.get(ix, iz);
  if (!s) {
    sites.makeRoom();
    const seed = `${domainConfig!.seed} - river`;
    s = {
      x: (ix + seedRand(`${seed} - ${ix}X${iz}`)) * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_X,
      z: (iz + seedRand(`${seed} - ${ix}Z${iz}`)) * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_Z,
    };
    sites.set(ix, iz, s);
  }
  return s;
};
const cellOf = (x: number, z: number): [number, number] => [Math.floor((x - RIVER_GRID_SHIFT_X) / RIVER_GRID_SIZE), Math.floor((z - RIVER_GRID_SHIFT_Z) / RIVER_GRID_SIZE)];

const junctions = new Map<string, RiverJunction>();
/** The junction of three sites (each [ix, iz]), computed from them in one canonical order so every
 *  window builds it bit for bit the same. */
const junctionOf = (cells: [number, number][]): RiverJunction => {
  const sorted = [...cells].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const key = sorted.map((c) => `${c[0]},${c[1]}`).join("/");
  let j = junctions.get(key);
  if (j) return j;
  if (junctions.size > 32768) dropOldestHalf(junctions);
  const [a, b, c] = sorted.map(([ix, iz]) => siteAt(ix, iz));
  const ad = a.x * a.x + a.z * a.z;
  const bd = b.x * b.x + b.z * b.z;
  const cd = c.x * c.x + c.z * c.z;
  const D = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  const x = (ad * (b.z - c.z) + bd * (c.z - a.z) + cd * (a.z - b.z)) / D;
  const z = (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x)) / D;
  const seed = domainConfig!.seed;
  const zone = zoneAtWarped(x, z);
  const rivers = riversIn(zone);
  const jitter = 1 - RIVER_WIDTH_JITTER + 2 * RIVER_WIDTH_JITTER * seedRand(`${seed} - river width ${key}`);
  const width = Math.min(RIVER_WIDTH_MAX, jitter * rivers.width * (1 + riverWideningAt(x, z)));
  j = { key, x, z, width, water: isLakeBiome(zone.biome) };
  junctions.set(key, j);
  return j;
};

/** Every grid edge by its key: the river edge, or null where the roll gave it none. */
type Cell = [number, number];
const cellKey = (c: Cell): string => `${c[0]},${c[1]}`;
const edgeKeyOf = (p: Cell, q: Cell): string => {
  const kp = cellKey(p);
  const kq = cellKey(q);
  return kp < kq ? `${kp}~${kq}` : `${kq}~${kp}`;
};

/** The midpoint of the edge between two junctions: the biome under it rolls its river and rules it. */
const midpointOf = (a: RiverJunction, b: RiverJunction): PointXZ => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/** An edge's own ROLL: kept by the chance of the biome under its midpoint (its own <Rivers chance>
 *  where it mounts one, else its region's). Pure: cached by key. */
const rolls = new Map<string, boolean>();
const rolledKeep = (key: string, a: RiverJunction, b: RiverJunction): boolean => {
  let kept = rolls.get(key);
  if (kept === undefined) {
    const mid = midpointOf(a, b);
    const chance = Math.min(1, biomeRiverChance(zoneAtWarped(mid.x, mid.z).biome) ?? nearestCell(mid, getRegionGrid(mid)).element.riverChance);
    kept = Math.hypot(b.x - a.x, b.z - a.z) > 1e-6 && chance > 0 && seedRand(`${domainConfig!.seed} - river edge ${key}`) < chance;
    if (rolls.size > 65536) dropOldestHalf(rolls);
    rolls.set(key, kept);
  }
  return kept;
};

/** How far the real ground rises over the straight water line between two junctions (each one's water
 *  WATER_BELOW_GROUND under its ground), as the gorge rule measures a gap. */
const joinRise = (a: RiverJunction, b: RiverJunction): number =>
  riseOverWaterLine(a.x, a.z, waterGroundAt(a.x, a.z).h - WATER_BELOW_GROUND, b.x, b.z, waterGroundAt(b.x, b.z).h - WATER_BELOW_GROUND);

/** Every edge of a window's trusted triangles: its key → the third cell of each triangle beside it. */
type EdgeThirds = Map<string, [Cell, Cell]>;
/** How many of junction (p, q, t)'s other two edges beside p~q rolled a river: 1 is a river END (null: the
 *  window cannot tell). */
const riversBeside = (p: Cell, q: Cell, t: Cell, thirds: EdgeThirds): number | null => {
  let kept = 0;
  for (const [u, v] of [
    [p, t],
    [q, t],
  ] as [Cell, Cell][]) {
    const key = edgeKeyOf(u, v);
    const th = thirds.get(key);
    if (!th) return null;
    if (rolledKeep(key, junctionOf([u, v, th[0]]), junctionOf([u, v, th[1]]))) kept++;
  }
  return kept;
};

const edges = new Map<string, RiverEdge | null>();
/** Edge p~q between the triangles whose third cells are third1 and third2: kept by its roll, or REVIVED
 *  where it would join a river end to another river — one junction holds exactly one ROLLED river, the
 *  other one or two (rolls only: a revived edge never makes another eligible, so nothing cascades; two
 *  ends alone missed Evan's case, a river end 311u from a junction its river runs through and ends 100u
 *  past, at a mountain's foot) — across a gap the gorge rule cuts by its rules: up to `shortGap` always, up
 *  to `gapFill` where the ground rises under `maxCarve` over the water line. Everything downstream
 *  (gorges, roads, ends, ponds) then treats it as any river. */
const edgeOf = (p: Cell, q: Cell, third1: Cell, third2: Cell, thirds: EdgeThirds): RiverEdge | null => {
  const key = edgeKeyOf(p, q);
  const cached = edges.get(key);
  if (cached !== undefined) return cached;
  if (edges.size > 16384) dropOldestHalf(edges);
  const j1 = junctionOf([p, q, third1]);
  const j2 = junctionOf([p, q, third2]);
  const [a, b] = j1.key < j2.key ? [j1, j2] : [j2, j1];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const mid = midpointOf(a, b);
  const rules = riversIn(zoneAtWarped(mid.x, mid.z));
  let kept = rolledKeep(key, a, b);
  let revived = false;
  if (!kept && len > 1e-6 && len <= rules.gapFill && !a.water && !b.water) {
    const n1 = riversBeside(p, q, third1, thirds);
    const n2 = riversBeside(p, q, third2, thirds);
    // Near the window's rim a neighbour's other triangle is not trusted: undecided, and NOT cached — the
    // window centred on the edge's own cell decides it (an edge cached here read as dropped in every list).
    if (n1 === null || n2 === null) return null;
    revived = Math.min(n1, n2) === 1 && (len <= rules.shortGap || joinRise(a, b) < rules.maxCarve);
    kept = revived;
  }
  const e: RiverEdge | null = kept
    ? { key, a, b, ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, len, count: Math.ceil(len / RIVER_PIECE_LENGTH), rules, ...(revived ? { revived } : {}) }
    : null;
  edges.set(key, e);
  return e;
};

/** The river edges reaching a river cell (warped), from the true Delaunay triangles of a window
 *  around it: a triangle is true when its circumcircle stays inside the window's sites. */
const cellEdges = new CellCache<RiverEdge[]>(1024);
const riverCellEdges = (cx: number, cz: number): RiverEdge[] => {
  let list = cellEdges.get(cx, cz);
  if (list) return list;
  const R = RIVER_WINDOW_CELLS;
  const cells: [number, number][] = [];
  const coords: number[] = [];
  for (let ix = cx - R; ix <= cx + R; ix++) {
    for (let iz = cz - R; iz <= cz + R; iz++) {
      const s = siteAt(ix, iz);
      cells.push([ix, iz]);
      coords.push(s.x, s.z);
    }
  }
  const d = new Delaunator(coords);
  const x0 = (cx - R) * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_X;
  const z0 = (cz - R) * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_Z;
  const x1 = x0 + (2 * R + 1) * RIVER_GRID_SIZE;
  const z1 = z0 + (2 * R + 1) * RIVER_GRID_SIZE;
  const trusted = (t: number): boolean => {
    const [a, b, c] = [0, 1, 2].map((k) => cells[d.triangles[t * 3 + k]]);
    const j = junctionOf([a, b, c]);
    const s = siteAt(a[0], a[1]);
    const r = Math.hypot(s.x - j.x, s.z - j.z);
    return j.x - r > x0 && j.x + r < x1 && j.z - r > z0 && j.z + r < z1;
  };
  const bx0 = cx * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_X;
  const bz0 = cz * RIVER_GRID_SIZE + RIVER_GRID_SHIFT_Z;
  list = [];
  const pairs: [Cell, Cell, Cell, Cell][] = [];
  const thirds: EdgeThirds = new Map();
  for (let i = 0; i < d.halfedges.length; i++) {
    const o = d.halfedges[i];
    if (o < i) continue;
    const t1 = Math.floor(i / 3);
    const t2 = Math.floor(o / 3);
    if (!trusted(t1) || !trusted(t2)) continue;
    const p = cells[d.triangles[i]];
    const q = cells[d.triangles[i % 3 === 2 ? i - 2 : i + 1]];
    const third = (t: number) => cells[[0, 1, 2].map((k) => d.triangles[t * 3 + k]).find((v) => cells[v] !== p && cells[v] !== q)!];
    pairs.push([p, q, third(t1), third(t2)]);
    thirds.set(edgeKeyOf(p, q), [third(t1), third(t2)]);
  }
  for (const [p, q, th1, th2] of pairs) {
    const e = edgeOf(p, q, th1, th2, thirds);
    if (e && segmentBoxDistance(e.ax, e.az, e.ax + e.ux * e.len, e.az + e.uz * e.len, bx0, bz0, bx0 + RIVER_GRID_SIZE, bz0 + RIVER_GRID_SIZE) < 1) list.push(e);
  }
  list.sort((p, q) => (p.key < q.key ? -1 : 1));
  cellEdges.makeRoom();
  cellEdges.set(cx, cz, list);
  return list;
};

/** The river edges meeting at a junction. */
export const junctionEdges = (j: RiverJunction): RiverEdge[] => {
  const [cx, cz] = cellOf(j.x, j.z);
  return riverCellEdges(cx, cz).filter((e) => e.a.key === j.key || e.b.key === j.key);
};

/** Which piece of edge e touches junction j, and the joint there. */
export const pieceAt = (e: RiverEdge, j: RiverJunction): number => (e.a.key === j.key ? 0 : e.count - 1);
export const jointAt = (e: RiverEdge, j: RiverJunction): number => (e.a.key === j.key ? 0 : e.count);

/** Distance from segment a→b to an axis-aligned box (0 when they meet). */
const segmentBoxDistance = (ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): number => {
  // Clip the segment to the box (Liang–Barsky): any overlap is distance 0.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az)) return 0;
  const boxDist = (px: number, pz: number) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(z0 - pz, 0, pz - z1));
  let best = Math.min(boxDist(ax, az), boxDist(bx, bz));
  // A corner nearer the segment's interior than either end.
  const l2 = dx * dx + dz * dz;
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - cx, az + dz * t - cz));
  }
  return best;
};

/** How a stretch reaching a junction ends there: the river goes on (none), every other river there gave
 *  way to a road (blunt), or it ends NATURALLY — its end's roll decides. */
export type JunctionEnd = "none" | "blunt" | "natural";
/** How an end of a built stretch is shaped: a junction where the river goes on (none), a MOUTH into deep
 *  water (widened), a natural end — a POND where a <Pond riverEnd> kind rolls (ponds.ts riverEndPondOf),
 *  else ROUND: the river's own width to the end joint, closed by the field's round cap past it — or one a
 *  road made (blunt: drawn as a round end, retracted by the road layer's own limit). A pond end holding its
 *  pond's disc keeps the river's width; one whose disc may not stand (a lake, a road in reach) keeps the
 *  widening the road layer and the decks see. */
export type EndKind = "none" | "mouth" | "pond" | "round" | "blunt";
const widthShapeAt = (kind: EndKind, d: number): number =>
  kind === "mouth" || kind === "pond" ? RIVER_POND_FACTOR + (1 - RIVER_POND_FACTOR) * smoothstep(0, RIVER_POND_LENGTH, d) : 1;

/** One end of a built stretch: its joint, the junction it ends at (null: inside the edge, where `beyond`
 *  is the next piece's code), how it ends and, at a pond end, the <Pond> mount whose kind it rolled. */
export interface StretchEnd {
  joint: number;
  junction: RiverJunction | null;
  beyond: number;
  kind: EndKind;
  pond: PondMount | null;
}

/** Each built stretch of edge e for a set of piece codes, as its two ends. `junctionKind` says how a
 *  stretch reaching a junction ends there; every natural end but a mouth rolls its pond. */
export const stretchesOf = (e: RiverEdge, codes: Uint8Array, junctionKind: (j: RiverJunction) => JunctionEnd): [StretchEnd, StretchEnd][] => {
  const n = e.count;
  const out: [StretchEnd, StretchEnd][] = [];
  const endAt = (joint: number, piece: number): StretchEnd => {
    const junction = piece < 0 ? e.a : piece >= n ? e.b : null;
    const beyond = junction ? -1 : codes[piece];
    const end = junction ? junctionKind(junction) : beyond === PIECE_ROAD ? "blunt" : "natural";
    if (end !== "natural") return { joint, junction, beyond, kind: end, pond: null };
    if (junction ? junction.water : beyond === PIECE_WATER) return { joint, junction, beyond, kind: "mouth", pond: null };
    const pond = riverEndPondOf(e, joint);
    return { joint, junction, beyond, kind: pond ? "pond" : "round", pond };
  };
  for (let i0 = 0; i0 < n; ) {
    if (!pieceBuilt(codes[i0])) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < n && pieceBuilt(codes[i1 + 1])) i1++;
    out.push([endAt(i0, i0 - 1), endAt(i1 + 1, i1 + 1)]);
    i0 = i1 + 1;
  }
  return out;
};

/** The width factor at every joint of edge e for its built stretches: linear between its junctions,
 *  times the shape of each end of the stretch the joint belongs to (an end holding a pond's disc, `ponds`
 *  by joint, keeps its width whatever its kind), times its climbs' narrowing (summits.ts). */
const widthsOf = (e: RiverEdge, stretches: [StretchEnd, StretchEnd][], ponds: readonly number[]): Float64Array => {
  const n = e.count;
  const L = e.len / n;
  const w = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) w[k] = e.a.width + ((e.b.width - e.a.width) * k) / n;
  for (const [low, high] of stretches) {
    const lowKind = ponds.includes(low.joint) ? "none" : low.kind;
    const highKind = ponds.includes(high.joint) ? "none" : high.kind;
    for (let k = low.joint; k <= high.joint; k++) w[k] = Math.min(RIVER_SHAPED_MAX, w[k] * widthShapeAt(lowKind, (k - low.joint) * L) * widthShapeAt(highKind, (high.joint - k) * L));
  }
  climbTaper(e, w);
  return w;
};

/** The width factor at every joint of edge e for a set of piece codes (widthsOf). */
export const stretchWidths = (e: RiverEdge, codes: Uint8Array, junctionKind: (j: RiverJunction) => JunctionEnd, ponds: readonly number[] = []): Float64Array =>
  widthsOf(e, stretchesOf(e, codes, junctionKind), ponds);

/** Edge e as built: its final codes, end ponds, joint widths and pieces (cached on it). */
export const finalEdge = (e: RiverEdge): (RiverPiece | null)[] => {
  if (e.pieces) return e.pieces;
  const codes = finalCodes(e);
  const stretches = stretchesOf(e, codes, (j) => junctionEndKind(e, j));
  e.ponds = endPondsOf(e, stretches.flat(), e.roads ?? []);
  const widths = widthsOf(
    e,
    stretches,
    e.ponds.map((p) => p.joint),
  );
  const L = e.len / e.count;
  const pieces: (RiverPiece | null)[] = [];
  for (let i = 0; i < e.count; i++) {
    pieces.push(
      pieceBuilt(codes[i])
        ? { sx: e.ax + e.ux * L * i, sz: e.az + e.uz * L * i, ex: e.ax + e.ux * L * (i + 1), ez: e.az + e.uz * L * (i + 1), w0: widths[i], w1: widths[i + 1], edge: e, index: i }
        : null,
    );
  }
  e.widths = widths;
  e.pieces = pieces;
  return pieces;
};

/** Piece i of edge e, or null when it is not built. */
export const riverEdgePiece = (e: RiverEdge, i: number): RiverPiece | null => finalEdge(e)[i] ?? null;
export const riverPieceBuilt = (p: RiverPiece): boolean => riverEdgePiece(p.edge, p.index) !== null;
/** Whether a built river runs on past junction j from edge e. */
export const riverContinuesAt = (e: RiverEdge, j: RiverJunction): boolean => junctionEdges(j).some((f) => f.key !== e.key && riverEdgePiece(f, pieceAt(f, j)) !== null);
/** Whether a piece ENDS its river at its start and at its end. */
export const riverPieceEnds = (p: RiverPiece): [boolean, boolean] => {
  const e = p.edge;
  const start = p.index === 0 ? !riverContinuesAt(e, e.a) : !riverEdgePiece(e, p.index - 1);
  const end = p.index === e.count - 1 ? !riverContinuesAt(e, e.b) : !riverEdgePiece(e, p.index + 1);
  return [start, end];
};

/** The river edges whose line comes within `pad` of a warped box, in key order. */
const edgesNear = (minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverEdge[] => {
  if (!riversEnabled) return [];
  const [cx0, cz0] = cellOf(minX - pad, minZ - pad);
  const [cx1, cz1] = cellOf(maxX + pad, maxZ + pad);
  const seen = new Map<string, RiverEdge>();
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) for (const e of riverCellEdges(cx, cz)) seen.set(e.key, e);
  return [...seen.values()].filter((e) => segmentBoxDistance(e.ax, e.az, e.ax + e.ux * e.len, e.az + e.uz * e.len, minX, minZ, maxX, maxZ) <= pad).sort((p, q) => (p.key < q.key ? -1 : 1));
};

/** The built pieces whose centerline comes within `pad` of a warped box: as built, or `raw` — before the
 *  road layer (a superset, for an early out that must not build the road layer). */
export const riverPiecesIn = (minX: number, minZ: number, maxX: number, maxZ: number, pad: number, raw = false): RiverPiece[] => {
  const out: RiverPiece[] = [];
  for (const e of edgesNear(minX, minZ, maxX, maxZ, pad)) {
    const L = e.len / e.count;
    if (raw) {
      const codes = climbedCodes(e);
      for (let i = 0; i < e.count; i++) {
        if (!pieceBuilt(codes[i])) continue;
        const sx = e.ax + e.ux * L * i;
        const sz = e.az + e.uz * L * i;
        if (segmentBoxDistance(sx, sz, sx + e.ux * L, sz + e.uz * L, minX, minZ, maxX, maxZ) <= pad) out.push({ sx, sz, ex: sx + e.ux * L, ez: sz + e.uz * L, w0: 1, w1: 1, edge: e, index: i });
      }
      continue;
    }
    for (const p of finalEdge(e)) if (p && segmentBoxDistance(p.sx, p.sz, p.ex, p.ez, minX, minZ, maxX, maxZ) <= pad) out.push(p);
  }
  return out;
};
export const riverPiecesRaw = (minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverPiece[] => riverPiecesIn(minX, minZ, maxX, maxZ, pad, true);
/** The built pieces within `pad` of a warped box. */
export const riverPiecesNear = (minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverPiece[] => riverPiecesIn(minX, minZ, maxX, maxZ, pad);

/** The built pieces of the river cell holding a warped point (tests, probes). */
export const getRiverSegments = (warped: PointXZ): RiverPiece[] => {
  if (!riversEnabled) return [];
  const [cx, cz] = cellOf(warped.x, warped.z);
  return riverCellEdges(cx, cz).flatMap((e) => finalEdge(e).filter((p): p is RiverPiece => p !== null));
};

export const initRivers = (config: DomainConfig): void => {
  riversEnabled = config.regions.some((r) => r.riverChance > 0 || r.biomes.some((b) => (biomeRiverChance(b) ?? 0) > 0));
  sites.clear();
  junctions.clear();
  edges.clear();
  rolls.clear();
  cellEdges.clear();
  clearRiverShapes();
  clearPieceRules();
  clearSummits();
  clearRiverSurfaces();
};
