/**
 * Which pieces of a river edge are BUILT (CLAUDE.md "Rivers", the network's rules (1)–(5)): a piece is
 * not built deep in water (the mouth runs RIVER_MOUTH_REACH into the basin), near a prohibitRivers
 * biome, or on high/steep ground judged on a terrain proxy; steep gaps between river and water are
 * filled, short blobs dropped, and gaps of low enough ridges are cut through as GORGES (junctionGorgesAt
 * and the in-edge gaps of riverEdgeBlocked). A new rule is one more verdict in classifyRiverPieces or one
 * more pass in riverEdgeOwnBlocked.
 */

import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { lakeSurface, restoreShore, saveShore } from "../lakes";
import { biomeNoiseHeight, terrainNoise, unwarp } from "../noise";
import type { DomainConfig } from "../types";
import { blendedTerrainAt } from "../vertexCompute";
import { biomeSiteAt, getBiomeContext, nearestBiomeSite, zoneAtWarped } from "../voronoi";
import { accumulateWallFields, combineZoneWeights, restoreWallPass, saveWallPass, sstep01, zoneFinal, zoneWeights } from "../zoneBlend";
import {
  RIVER_BLOCK_HIGH,
  RIVER_BLOCK_MOUNTAIN,
  RIVER_BLOCK_PROHIBITED,
  RIVER_BLOCK_WATER,
  RIVER_GAP_FILL,
  RIVER_POND_FACTOR,
  RIVER_SURFACE_BELOW,
  riverKeepOff,
} from "./constants";
import { riverDebug, riverJunctionEdges } from "./riverNetwork";
import type { RiverEdge, RiverGorge } from "./types";

/** A piece is water-blocked only this deep into water cells in BOTH directions along its edge —
 *  symmetric, so the mouth never depends on which way the edge is walked. */
const RIVER_MOUTH_REACH = 160;
/** High ground: a piece is not built where its biome relief exceeds MAX_RELIEF (the mountain's
 *  rock), where the ground climbs faster than MAX_GRADE along it (the surface follows the terrain:
 *  water would visibly run up the slope), or where it would sit on a ridge or across a hillside — its
 *  centerline MAX_RIDGE above both banks' outer edges, or the banks differing by more than
 *  MAX_CROSS_GRADE across the footprint (a perched channel every road crossing it must climb to). */
const RIVER_MAX_RELIEF = 40;
const RIVER_MAX_GRADE = 0.2;
const RIVER_MAX_RIDGE = 6;
const RIVER_MAX_CROSS_GRADE = 0.15;
/** A built stretch shorter than this between two unbuilt pieces is not built (a pond blob). */
const RIVER_MIN_STRETCH = 300;
/** A GORGE is built through a gap of high ground or tall relief that is not the mountain's rock —
 *  inside an edge where the gap fill left it, or at a JUNCTION (an edge's run into a junction where
 *  another river goes on, or where another edge's run comes out of its river), up to RIVER_GAP_FILL in
 *  all — when the REAL ground rises less than this above the straight line between the two water
 *  surfaces it joins (gorgeRise). MEASURED over an 80 km square: the gaps like image 86 rise up to 24,
 *  the shortest ridge like 87 left out 29.8. */
const RIVER_GORGE_MAX_RISE = 25;
/** The ridge rise is sampled this often along a junction gap (real units). */
const RIVER_GORGE_RISE_STEP = 10;

const junctionGorges = new Map<string, Map<string, RiverGorge>>();
let riversProhibitedSomewhere = false;

export const initRiverPieceRules = (config: DomainConfig): void => {
  junctionGorges.clear();
  riversProhibitedSomewhere = config.regions.some((r) => r.biomes.some((b) => b.prohibitRivers));
};

// A cheap stand-in for the terrain the river would sit on, to judge "high ground" while building
// the network (a real evaluation per piece needs every biome cell's freeway network across a
// ~20km window): the zone's region base plus its biome relief, faded in by the distance to its
// cell's edge like the real presence.
let proxyRelief = 0;
/** Whether the last riverTerrainProxy's zone is a domed biome (the mountain's rock). */
let proxyRock = false;
const riverTerrainProxy = (wx: number, wz: number): number => {
  const own = nearestBiomeSite(wx, wz);
  const zone = own.zone;
  const world = unwarp(wx, wz);
  const base = terrainNoise(zone.baseNoise, world.x, world.z);
  proxyRelief = 0;
  const cfg = domainConfig!.biomeNoiseConfigs[zone.biome.id];
  proxyRock = !!cfg?.dome;
  if (!cfg || zone.biome.water) return base;
  let edge = Infinity;
  const d0 = (wx - own.x) ** 2 + (wz - own.z) ** 2;
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(wx / gs);
  const cz = Math.floor(wz / gs);
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const cell = biomeSiteAt(ix, iz);
      if (cell === own || (cell.zone === zone && zone.biome.joinable)) continue;
      const sep = Math.hypot(cell.x - own.x, cell.z - own.z);
      const d = ((wx - cell.x) ** 2 + (wz - cell.z) ** 2 - d0) / (2 * sep);
      if (d < edge) edge = d;
    }
  }
  proxyRelief = biomeNoiseHeight(cfg, world.x, world.z) * (zone.crisp ? 1 : sstep01(edge / zone.heightPresenceWidth));
  return base + proxyRelief;
};

const isWaterAt = (x: number, z: number): boolean => !!zoneAtWarped(x, z).biome.water;

const RIVER_PROHIBIT_PROBES = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.71, 0.71],
  [-0.71, 0.71],
  [0.71, -0.71],
  [-0.71, -0.71],
];

/** Each piece's RIVER_BLOCK_* verdict on its own (0 = built): deep in water, near a prohibitRivers
 *  biome, mountainous, or high/steep ground. */
const classifyRiverPieces = (e: RiverEdge): Uint8Array => {
  const n = e.count;
  const step = e.len / n;
  const heights = new Float64Array(n + 1);
  const reliefs = new Float64Array(n + 1);
  const rockAt = new Uint8Array(n + 1);
  for (let k = 0; k <= n; k++) {
    heights[k] = riverTerrainProxy(e.ax + e.ux * k * step, e.az + e.uz * k * step);
    reliefs[k] = proxyRelief;
    rockAt[k] = proxyRock ? 1 : 0;
  }
  e.rock = new Uint8Array(n);
  const reach = riverKeepOff();
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * step;
    const mx = e.ax + e.ux * s;
    const mz = e.az + e.uz * s;
    const r = reach * (e.wA + (e.wB - e.wA) * (s / e.len));
    if (
      isWaterAt(mx, mz) &&
      isWaterAt(mx - e.ux * RIVER_MOUTH_REACH, mz - e.uz * RIVER_MOUTH_REACH) &&
      isWaterAt(mx + e.ux * RIVER_MOUTH_REACH, mz + e.uz * RIVER_MOUTH_REACH)
    ) {
      blocked[i] = RIVER_BLOCK_WATER;
    } else if (
      riversProhibitedSomewhere &&
      // The whole footprint of a pond end must stay clear of the biome.
      RIVER_PROHIBIT_PROBES.some(
        ([px, pz]) =>
          zoneAtWarped(mx + px * r * RIVER_POND_FACTOR, mz + pz * r * RIVER_POND_FACTOR).biome.prohibitRivers,
      )
    ) {
      blocked[i] = RIVER_BLOCK_PROHIBITED;
    } else {
      // The grade over the piece and its neighbors: one steep hummock is not a slope.
      const k0 = Math.max(0, i - 1);
      const k1 = Math.min(n, i + 2);
      const grade = Math.abs(heights[k1] - heights[k0]) / ((k1 - k0) * step);
      const center = riverTerrainProxy(mx, mz);
      const left = riverTerrainProxy(mx - e.uz * r, mz + e.ux * r);
      const right = riverTerrainProxy(mx + e.uz * r, mz - e.ux * r);
      if (Math.max(reliefs[i], reliefs[i + 1]) > RIVER_MAX_RELIEF) {
        blocked[i] = RIVER_BLOCK_MOUNTAIN;
        e.rock[i] =
          (reliefs[i] > RIVER_MAX_RELIEF && rockAt[i]) || (reliefs[i + 1] > RIVER_MAX_RELIEF && rockAt[i + 1]) ? 1 : 0;
      } else if (
        grade > RIVER_MAX_GRADE ||
        center - Math.max(left, right) > RIVER_MAX_RIDGE ||
        Math.abs(left - right) / (2 * r) > RIVER_MAX_CROSS_GRADE
      ) {
        blocked[i] = RIVER_BLOCK_HIGH;
      }
    }
  }
  return blocked;
};

/** Steep (not mountainous) gaps up to RIVER_GAP_FILL between river and river, or river and water,
 *  are built: the river runs through to its other stretch or into the sea. Past the edge's end, the
 *  side is its junction: water when the junction lies in a water zone. */
const fillRiverGaps = (e: RiverEdge, blocked: Uint8Array): void => {
  const n = e.count;
  const step = e.len / n;
  const sideOf = (k: number, junctionX: number, junctionZ: number): number =>
    k >= 0 && k < n ? blocked[k] : isWaterAt(junctionX, junctionZ) ? RIVER_BLOCK_WATER : RIVER_BLOCK_HIGH;
  const riverish = (code: number) => code === 0 || code === RIVER_BLOCK_WATER;
  for (let i0 = 0; i0 < n; ) {
    if (blocked[i0] !== RIVER_BLOCK_HIGH) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < n && blocked[i1 + 1] === RIVER_BLOCK_HIGH) i1++;
    const before = sideOf(i0 - 1, e.ax, e.az);
    const after = sideOf(i1 + 1, e.ax + e.ux * e.len, e.az + e.uz * e.len);
    if ((i1 - i0 + 1) * step <= RIVER_GAP_FILL && riverish(before) && riverish(after)) blocked.fill(0, i0, i1 + 1);
    i0 = i1 + 1;
  }
};

/** A short built stretch with unbuilt pieces on both sides would be a pond blob: not built either.
 *  Per edge only — a stretch reaching a junction may continue into another river. */
const dropRiverBlobs = (e: RiverEdge, blocked: Uint8Array): void => {
  const n = e.count;
  const step = e.len / n;
  for (let i0 = 1; i0 < n; ) {
    if (blocked[i0] || !blocked[i0 - 1]) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < n && !blocked[i1 + 1]) i1++;
    // (Not a stretch joining water to water: it runs across the land between them.)
    const waterBoth = blocked[i0 - 1] === RIVER_BLOCK_WATER && blocked[i1 + 1] === RIVER_BLOCK_WATER;
    if (i1 + 1 < n && !waterBoth && (i1 - i0 + 1) * step < RIVER_MIN_STRETCH)
      blocked.fill(RIVER_BLOCK_HIGH, i0, i1 + 1);
    i0 = i1 + 1;
  }
};

/** The edge on its own: its pieces classified, its gaps filled, its blobs dropped. Cached on the edge. */
const riverEdgeOwnBlocked = (e: RiverEdge): Uint8Array => {
  if (e.ownBlocked) return e.ownBlocked;
  const blocked = classifyRiverPieces(e);
  fillRiverGaps(e, blocked);
  dropRiverBlobs(e, blocked);
  e.ownBlocked = blocked;
  return blocked;
};

const pieceEndX = (e: RiverEdge, k: number): number => e.ax + e.ux * k * (e.len / e.count);
const pieceEndZ = (e: RiverEdge, k: number): number => e.az + e.uz * k * (e.len / e.count);


/** Whether piece i of the edge on its own may be cut through by a gorge: high ground, or a tall
 *  relief that is not the mountain's rock (the dunes' run 50–200u: by the relief rule alone every
 *  dune was "mountain", and a river ended in two ponds across a 19u rise, image 88). */
const gorgeable = (e: RiverEdge, i: number): boolean => {
  const b = riverEdgeOwnBlocked(e)[i];
  return b === RIVER_BLOCK_HIGH || (b === RIVER_BLOCK_MOUNTAIN && e.rock![i] === 0);
};

/** How many gorgeable pieces run from junction A (or B) of the edge on its own into a built piece: 0
 *  where the piece at the junction is built, -1 where the run meets anything else (water, the
 *  mountain's rock, a prohibited biome) or never meets a built piece. */
const junctionRun = (e: RiverEdge, atA: boolean): number => {
  const b = riverEdgeOwnBlocked(e);
  const n = e.count;
  let k = 0;
  while (k < n && gorgeable(e, atA ? k : n - 1 - k)) k++;
  return k < n && b[atA ? k : n - 1 - k] === 0 ? k : -1;
};

/** A junction gap's centerline from its river end to the junction (piece ends, warped, flat x, z). */
const junctionGapPath = (e: RiverEdge, atA: boolean, k: number): number[] => {
  const path: number[] = [];
  for (let q = k; q >= 0; q--) {
    const i = atA ? q : e.count - q;
    path.push(pieceEndX(e, i), pieceEndZ(e, i));
  }
  return path;
};

/** The REAL ground at a warped point — the zone-blended terrain with its shore, as a river surface
 *  samples it (riverField's riverSurfaceAt) — for gorgeRise, whose caller saves and restores the
 *  wall pass and the shore state around it. The proxy read the ridges wrong by up to 35u (dunes beside
 *  another region's base, the snow's slopes): a gorge is decided on the terrain it cuts. */
const gorgeGroundAt = (wx: number, wz: number): number => {
  const warped = { x: wx, z: wz };
  const ctx = getBiomeContext(warped);
  accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, ctx, ctx.zone);
  const world = unwarp(wx, wz);
  return blendedTerrainAt(world.x, world.z, ctx.zone, ctx);
};

/** How far the real ground rises along a gap's centerline (flat x, z, from one water's end to the
 *  other's) above the straight line between the two water surfaces. Runs wherever the network is
 *  built — mid-vertex too (a city's waterfront asks for the pieces near a wall) — so it leaves the
 *  wall pass and the shore state as it found them. */
const gorgeRise = (path: number[]): number => {
  const pass = saveWallPass();
  const shore = saveShore();
  const m = path.length / 2;
  let total = 0;
  for (let i = 1; i < m; i++) total += Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]);
  const g0 = gorgeGroundAt(path[0], path[1]);
  const g1 = gorgeGroundAt(path[m * 2 - 2], path[m * 2 - 1]);
  let rise = -Infinity;
  let along = 0;
  for (let i = 1; i < m; i++) {
    const ax = path[i * 2 - 2];
    const az = path[i * 2 - 1];
    const l = Math.hypot(path[i * 2] - ax, path[i * 2 + 1] - az);
    const steps = Math.max(1, Math.ceil(l / RIVER_GORGE_RISE_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const g = gorgeGroundAt(ax + (path[i * 2] - ax) * t, az + (path[i * 2 + 1] - az) * t);
      rise = Math.max(rise, g - (g0 + (g1 - g0) * ((along + l * t) / total)));
    }
    along += l;
  }
  restoreWallPass(pass);
  restoreShore(shore);
  return rise + RIVER_SURFACE_BELOW;
};

/** THE JUNCTION GAPS of a junction (RIVER_GORGE_MAX_RISE), by edge key: each edge's high run into the
 *  junction that is built as a gorge. Where a river goes on through the junction, a run whose ridge is
 *  low enough joins it; else the runs of two edges together, up to RIVER_GAP_FILL, whose ridge is low
 *  enough join each other, and the lowest such pair sets the junction's water for every gorge there.
 *  Decided from the edges on their own (riverEdgeOwnBlocked), so a pure function of the junction. */
const junctionGorgesAt = (junction: string, jx: number, jz: number): Map<string, RiverGorge> => {
  let gorges = junctionGorges.get(junction);
  if (gorges) return gorges;
  if (junctionGorges.size > 4096) dropOldestHalf(junctionGorges);
  gorges = new Map();
  const edges = riverJunctionEdges(junction, jx, jz).sort((a, b) => (a.key < b.key ? -1 : 1));
  const atA = edges.map((e) => e.keyA === junction);
  const runs = edges.map((e, i) => junctionRun(e, atA[i]));
  const lens = edges.map((e, i) => (runs[i] * e.len) / e.count);
  const gap = (i: number) => runs[i] > 0 && lens[i] <= RIVER_GAP_FILL;
  const gorgeOf = (i: number, pair: boolean, p = -1, q = -1): RiverGorge => {
    const e = edges[i];
    const from = atA[i] ? runs[i] : e.count - runs[i];
    const to = atA[i] ? 0 : e.count;
    const end = (j: number, xz: 0 | 1) =>
      j < 0 ? NaN : (xz === 0 ? pieceEndX : pieceEndZ)(edges[j], atA[j] ? runs[j] : edges[j].count - runs[j]);
    return {
      from,
      to,
      bx: pieceEndX(e, from),
      bz: pieceEndZ(e, from),
      jx: pieceEndX(e, to),
      jz: pieceEndZ(e, to),
      pair,
      px: end(p, 0),
      pz: end(p, 1),
      qx: end(q, 0),
      qz: end(q, 1),
      share: pair ? lens[p] / (lens[p] + lens[q]) : 0,
    };
  };
  if (runs.some((r) => r === 0)) {
    edges.forEach((_, i) => {
      if (gap(i) && gorgeRise(junctionGapPath(edges[i], atA[i], runs[i])) < RIVER_GORGE_MAX_RISE)
        gorges!.set(edges[i].key, gorgeOf(i, false));
    });
  } else {
    let best: [number, number, number] | null = null;
    const joined = new Set<number>();
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if (!gap(i) || !gap(j) || lens[i] + lens[j] > RIVER_GAP_FILL) continue;
        const pi = junctionGapPath(edges[i], atA[i], runs[i]);
        const pj = junctionGapPath(edges[j], atA[j], runs[j]);
        const back: number[] = [];
        for (let s = pj.length - 4; s >= 0; s -= 2) back.push(pj[s], pj[s + 1]);
        const rise = gorgeRise([...pi, ...back]);
        if (!(rise < RIVER_GORGE_MAX_RISE)) continue;
        joined.add(i).add(j);
        if (!best || rise < best[0]) best = [rise, i, j];
      }
    }
    if (best) for (const i of joined) gorges.set(edges[i].key, gorgeOf(i, true, best[1], best[2]));
  }
  junctionGorges.set(junction, gorges);
  return gorges;
};

/** Per piece of a river edge: 0 = built, else the RIVER_BLOCK_* reason — the edge on its own, its
 *  junction gaps joined (junctionGorgesAt, recording the gorges). Cached on the edge. */
export const riverEdgeBlocked = (e: RiverEdge): Uint8Array => {
  if (e.blocked) return e.blocked;
  const own = riverEdgeOwnBlocked(e);
  let blocked = own;
  for (const atA of [true, false]) {
    const k = junctionRun(e, atA);
    if (k <= 0 || (k * e.len) / e.count > RIVER_GAP_FILL) continue;
    const g = junctionGorgesAt(
      atA ? e.keyA : e.keyB,
      pieceEndX(e, atA ? 0 : e.count),
      pieceEndZ(e, atA ? 0 : e.count),
    ).get(e.key);
    if (!g) continue;
    if (blocked === own) blocked = own.slice();
    blocked.fill(0, atA ? 0 : e.count - k, atA ? k : e.count);
    e.gorges.push(g);
    riverDebug.gorgePieces += k;
  }
  // Gaps INSIDE the edge the gap fill left (fillRiverGaps fills high ground alone, at any rise): a run
  // of gorgeable pieces between two built ones, up to RIVER_GAP_FILL, whose ridge is low enough.
  const n = e.count;
  const step = e.len / n;
  for (let i0 = 1; i0 < n; ) {
    if (own[i0] === 0 || own[i0 - 1] !== 0) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < n && own[i1 + 1] !== 0) i1++;
    const from = i0;
    const to = i1 + 1;
    i0 = to;
    if (to >= n || (to - from) * step > RIVER_GAP_FILL) continue;
    let ok = true;
    for (let i = from; i < to && ok; i++) ok = gorgeable(e, i);
    if (!ok) continue;
    const path: number[] = [];
    for (let k = from; k <= to; k++) path.push(pieceEndX(e, k), pieceEndZ(e, k));
    if (!(gorgeRise(path) < RIVER_GORGE_MAX_RISE)) continue;
    if (blocked === own) blocked = own.slice();
    blocked.fill(0, from, to);
    e.gorges.push({
      from,
      to,
      bx: pieceEndX(e, from),
      bz: pieceEndZ(e, from),
      jx: pieceEndX(e, to),
      jz: pieceEndZ(e, to),
      pair: false,
      px: NaN,
      pz: NaN,
      qx: NaN,
      qz: NaN,
      share: 0,
    });
    riverDebug.gorgePieces += to - from;
  }
  e.blocked = blocked;
  riverDebug.pieces += e.count;
  for (const b of blocked) riverDebug.blocked[b]++;
  return blocked;
};
