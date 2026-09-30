/**
 * RIVERS — the edges of their OWN voronoi grid (CLAUDE.md "Rivers").
 *
 * Rivers are the edges of a third voronoi grid (RIVER_GRID_SIZE, shifted by RIVER_GRID_SHIFT so it
 * never lines up with the region grid), independent of biomes and roads: a pure function of
 * position, so every chunk, worker and window agrees by construction. Three layers:
 *  1. getRiverSegments (this file) — the network: each edge rolls whether it carries a river (its
 *     region's riverProbability), is cut into RIVER_SEGMENT_LENGTH pieces, and a piece is NOT built
 *     deep in water (the mouth runs RIVER_MOUTH_REACH into the basin), near a prohibitRivers biome,
 *     or on high/steep ground (nor a short blob between such pieces) — steep but not mountainous
 *     ground only where it runs longer than RIVER_GAP_FILL or not between river and water. A river
 *     ends in a pond where a piece is not built, and in a pond or a fizzle at a natural end (a
 *     junction no other built river leaves). Widths are per junction, growing toward the ocean.
 *  2. The road layer (riverRoadLayer.ts) — where a freeway meets a river no deck may carry, the road
 *     wins: the river is not built there and ends bluntly on either side. Applied lazily per piece
 *     (resolveRiverPiece: it needs the freeway network), cached on the edge.
 *  3. riverFieldAt (riverField.ts) — per vertex: the distance in factor-1 units (the real distance ÷
 *     the local width factor, so every consumer compares against the `river` config), the width
 *     factor and the water surface, combined across rivers by a compact smooth minimum (fillets at
 *     confluences, no argmin jumps). The surface is a function of the CENTERLINE only — the terrain
 *     at each piece end, interpolated — so it is level across the channel.
 * The city adapts to the river (the quay road in getCityTerrain), never the other way round.
 */

import Delaunator from "delaunator";
import { seedRand, smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { biomeNoiseHeight, terrainNoise, unwarp } from "../noise";
import type { DomainConfig, SerializedRegion } from "../types";
import { biomeSiteAt, getRegionGrid, nearestBiomeSite, nearestCell, regionSiteAt, zoneAtWarped } from "../voronoi";
import { sstep01 } from "../zoneBlend";
import { clearRiverRoadLayer, riverPieceSuppressed } from "./riverRoadLayer";

const RIVER_GRID_SIZE = 2800;
const RIVER_GRID_SHIFT = { x: 1237, z: 811 };
/** Sites ±6 cells around the query's river cell. Only TRUSTED triangles — circumcircle at least a
 *  cell inside the sites, so no site outside the window could fall in it — make edges: an edge is
 *  cached by its two sites, and one first built from a distorted border triangle had the wrong
 *  junctions everywhere after (MEASURED: a chunk's decks changed with what had been queried before). */
const RIVER_GRID_RADIUS_CELLS = 6;
/** Edges reaching the query's river cell ± this are emitted: ≥ what one query needs (a biome cell's
 *  reach; a bridge window reads every river cell it overlaps). */
const RIVER_TRUST_MARGIN = 2400;
const RIVER_CACHE_MAX = 32;
/** An edge carries a river with probability RIVER_KEEP_PER_PROBABILITY × its region's
 *  riverProbability (capped at 1): 0.78 at the 0.45 default — the density the network was tuned
 *  at, and connected-looking — so the desert (0.15) keeps a quarter of its edges and snow/ocean
 *  nearly all. Resolved by the region under the edge's midpoint. */
const RIVER_KEEP_PER_PROBABILITY = 0.78 / 0.45;
const RIVER_SEGMENT_LENGTH = 50;
/** Per-junction width jitter (±25%) and the boost toward the ocean (×1.9 at an all-water region's site). */
const RIVER_WIDTH_JITTER = 0.5;
const RIVER_OCEAN_BOOST = 0.9;
const RIVER_OCEAN_REACH = 5000;
const RIVER_WIDTH_MAX = 2.4;
/** End shapes: a pond is the capsule end fattened over its last POND_LENGTH; a fizzle thins to
 *  FIZZLE_FACTOR over its last FIZZLE_LENGTH only (a whole-edge taper read as a ditch). */
const RIVER_POND_FACTOR = 1.7;
const RIVER_POND_LENGTH = 100;
const RIVER_FIZZLE_FACTOR = 0.12;
const RIVER_FIZZLE_LENGTH = 300;
/** A piece is water-blocked only this deep into water cells in BOTH directions along its edge —
 *  symmetric, so the mouth never depends on which way the edge is walked. */
const RIVER_MOUTH_REACH = 160;
/** High ground: a piece is not built where its biome relief exceeds MAX_RELIEF (the mountain's
 *  rock), where the ground climbs faster than MAX_GRADE along it (the surface follows the terrain,
 *  and water visibly running up a slope was the complaint), or where it would sit on a ridge or
 *  across a hillside — its centerline MAX_RIDGE above both banks' outer edges, or the banks
 *  differing by more than MAX_CROSS_GRADE across the footprint (a perched channel that every road
 *  crossing it had to climb to, decks under the water). */
const RIVER_MAX_RELIEF = 40;
const RIVER_MAX_GRADE = 0.2;
const RIVER_MAX_RIDGE = 6;
const RIVER_MAX_CROSS_GRADE = 0.15;
/** A built stretch shorter than this between two unbuilt pieces is not built (a pond blob). */
const RIVER_MIN_STRETCH = 300;
/** Steep ground that is NOT the mountain's rock (grade, ridge, hillside) does not break a river over
 *  a gap up to this long whose both sides are river or water — two stretches of one river, or a
 *  stretch and the sea it runs into, so rivers connect to the water near them. MEASURED over a 40 km
 *  square: 159 of 201 gaps between stretches and 40 of 48 stretch ends short of the water along
 *  their edge were within this. The region bases (desert 260u over 1800u, snow 600u over 4000u)
 *  alone exceed the grade and hillside limits, so the rules cut ordinary rivers everywhere. */
const RIVER_GAP_FILL = 800;
/** The channel is measured from a meandered query point (±10u over ~90u), so a straight edge winds. */
export const RIVER_MEANDER_AMP = 10;
export const RIVER_MEANDER_SCALE = 90;
/** Smooth-minimum support between DIFFERENT rivers (factor-1 units): the confluence fillet. */
export const RIVER_FILLET = 24;
/** The surface sits this far under the terrain at the centerline: deeper than a lake's, so beside a
 *  city the quay road (curbHeight under the plateau) stays above the water. */
export const RIVER_SURFACE_BELOW = 2.5;

export const RIVER_BLOCK_WATER = 1;
const RIVER_BLOCK_PROHIBITED = 2;
const RIVER_BLOCK_HIGH = 3;
/** High ground that is genuinely mountainous (the biome relief past RIVER_MAX_RELIEF): never filled. */
const RIVER_BLOCK_MOUNTAIN = 4;
const RIVER_END_NONE = 0;
const RIVER_END_POND = 1;
const RIVER_END_FIZZLE = 2;

export interface RiverSegment {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  /** Width factors at the two ends (1 = the config's halfWidth/depth/bank), end shapes included. */
  w0: number;
  w1: number;
  /** The river-grid edge the piece belongs to and its index along it — its identity everywhere. */
  edge: string;
  index: number;
}

/** A river-grid edge that carries a river, cut into `count` equal pieces (warped space, oriented
 *  from the junction with the smaller key). Cached by key; every field is a pure function of the
 *  edge, so whichever window built it, it is the same edge. */
export interface RiverEdge {
  key: string;
  keyA: string;
  keyB: string;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  count: number;
  /** Junction width factors at A and B. */
  wA: number;
  wB: number;
  /** Per piece: 0 = built, else the RIVER_BLOCK_* reason. null until needed. */
  blocked: Uint8Array | null;
  /** Width factor at each piece end (count + 1), end shapes included. null until emitted. */
  widths: Float64Array | null;
  /** Road layer, lazily per piece (-1 = not evaluated). */
  along: Int8Array;
  suppressed: Int8Array;
  /** The road layer's verdict per piece (riverEdgeRoadLayer), and before its end retraction; null until needed. */
  roadLayer: Uint8Array | null;
  roadUnretracted: Uint8Array | null;
  /** Whether the river ENDS at junction A / B (a pond or a fizzle: no built river continues). */
  endA: boolean;
  endB: boolean;
  /** -1 = not evaluated; 0 = no city within FREEWAY_LINK_CELLS of the edge (no road can reach it). */
  nearRoads: number;
}

interface RiverCellEntry {
  segments: RiverSegment[];
  edges: RiverEdge[];
}

const NO_RIVERS: RiverCellEntry = { segments: [], edges: [] };
const riverCache = new Map<string, RiverCellEntry>();
const riverEdges = new Map<string, RiverEdge>();
const riverJunctionWidths = new Map<string, number>();
export let riversEnabled = false;
let riverKeepByRegion = new Map<number, number>();
let riverOceanRegions = new Set<number>();
let riversProhibitedSomewhere = false;

export const initRivers = (config: DomainConfig): void => {
  riverCache.clear();
  riverEdges.clear();
  riverJunctionWidths.clear();
  clearRiverRoadLayer();
  riverKeepByRegion = new Map(
    config.regions.map((r) => [r.id, Math.min(1, RIVER_KEEP_PER_PROBABILITY * (r.riverProbability ?? config.river.defaultProbability))]),
  );
  riversEnabled = [...riverKeepByRegion.values()].some((p) => p > 0);
  riverOceanRegions = new Set(config.regions.filter((r) => r.biomes.length > 0 && r.biomes.every((b) => !!b.water)).map((r) => r.id));
  riversProhibitedSomewhere = config.regions.some((r) => r.biomes.some((b) => b.prohibitRivers));
};

/** Dressing keeps this far (factor-1 river units) from a river centerline: the channel and its banks. */
export const riverKeepOff = (): number => domainConfig!.river.halfWidth + domainConfig!.river.bank;

/** Nearness (1 at the site, 0 at RIVER_OCEAN_REACH) to the nearest all-water region cell's site. */
const oceanNearness = (x: number, z: number): number => {
  if (riverOceanRegions.size === 0) return 0;
  const rg = domainConfig!.regionGridSize;
  const span = Math.ceil(RIVER_OCEAN_REACH / rg);
  const cx = Math.floor(x / rg);
  const cz = Math.floor(z / rg);
  let best = Infinity;
  for (let ix = cx - span; ix <= cx + span; ix++) {
    for (let iz = cz - span; iz <= cz + span; iz++) {
      const site = regionSiteAt(ix, iz);
      const d = Math.hypot(site.x - x, site.z - z);
      if (d >= best || d >= RIVER_OCEAN_REACH) continue;
      if (riverOceanRegions.has(site.region.id)) best = d;
    }
  }
  return best === Infinity ? 0 : 1 - best / RIVER_OCEAN_REACH;
};

const riverJunctionWidth = (key: string, x: number, z: number): number => {
  let w = riverJunctionWidths.get(key);
  if (w === undefined) {
    if (riverJunctionWidths.size > 8192) dropOldestHalf(riverJunctionWidths);
    const jitter = 1 + RIVER_WIDTH_JITTER * (seedRand(`${domainConfig!.seed} - river width ${key}`) - 0.5);
    w = Math.min(RIVER_WIDTH_MAX, jitter * (1 + RIVER_OCEAN_BOOST * oceanNearness(x, z)));
    riverJunctionWidths.set(key, w);
  }
  return w;
};

// A cheap stand-in for the terrain the river would sit on, to judge "high ground" while building
// the network (a real evaluation per piece needs every biome cell's freeway network across a
// ~20km window): the zone's region base plus its biome relief, faded in by the distance to its
// cell's edge like the real presence.
let proxyRelief = 0;
const riverTerrainProxy = (wx: number, wz: number): number => {
  const own = nearestBiomeSite(wx, wz);
  const zone = own.zone;
  const world = unwarp(wx, wz);
  const base = terrainNoise(zone.baseNoise, world.x, world.z);
  proxyRelief = 0;
  const cfg = domainConfig!.biomeNoiseConfigs[zone.biome.id];
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

const RIVER_PROHIBIT_PROBES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];

export const riverEdgeBlocked = (e: RiverEdge): Uint8Array => {
  if (e.blocked) return e.blocked;
  const n = e.count;
  const step = e.len / n;
  const heights = new Float64Array(n + 1);
  const reliefs = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    heights[k] = riverTerrainProxy(e.ax + e.ux * k * step, e.az + e.uz * k * step);
    reliefs[k] = proxyRelief;
  }
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
      RIVER_PROHIBIT_PROBES.some(([px, pz]) => zoneAtWarped(mx + px * r * RIVER_POND_FACTOR, mz + pz * r * RIVER_POND_FACTOR).biome.prohibitRivers)
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
      } else if (
        grade > RIVER_MAX_GRADE ||
        center - Math.max(left, right) > RIVER_MAX_RIDGE ||
        Math.abs(left - right) / (2 * r) > RIVER_MAX_CROSS_GRADE
      ) {
        blocked[i] = RIVER_BLOCK_HIGH;
      }
    }
  }
  // Steep (not mountainous) gaps up to RIVER_GAP_FILL between river and river, or river and water,
  // are built: the river runs through to its other stretch or into the sea. Past the edge's end,
  // the side is its junction: water when the junction lies in a water zone.
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
  // A short built stretch with unbuilt pieces on both sides would be a pond blob: not built either.
  // (Per edge only — a stretch reaching a junction may continue into another river.)
  for (let i0 = 1; i0 < n; ) {
    if (blocked[i0] || !blocked[i0 - 1]) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < n && !blocked[i1 + 1]) i1++;
    // (Not a stretch joining water to water: it runs across the land between them.)
    const waterBoth = blocked[i0 - 1] === RIVER_BLOCK_WATER && blocked[i1 + 1] === RIVER_BLOCK_WATER;
    if (i1 + 1 < n && !waterBoth && (i1 - i0 + 1) * step < RIVER_MIN_STRETCH) blocked.fill(RIVER_BLOCK_HIGH, i0, i1 + 1);
    i0 = i1 + 1;
  }
  e.blocked = blocked;
  riverDebug.pieces += n;
  for (const b of blocked) riverDebug.blocked[b]++;
  return blocked;
};

const riverEndShape = (shape: number, u: number): number =>
  shape === RIVER_END_POND
    ? 1 + (RIVER_POND_FACTOR - 1) * (1 - smoothstep(0, RIVER_POND_LENGTH, u))
    : shape === RIVER_END_FIZZLE
      ? RIVER_FIZZLE_FACTOR + (1 - RIVER_FIZZLE_FACTOR) * smoothstep(0, RIVER_FIZZLE_LENGTH, u)
      : 1;

/** Widths along a built edge: junction widths interpolated, shaped at every end of every built
 *  stretch — a pond where a piece is not built, a pond or a fizzle (seeded per junction) where the
 *  river network itself ends (a junction no other built river leaves). */
const riverEdgeWidths = (e: RiverEdge, continuesAt: (junction: string) => boolean): Float64Array => {
  if (e.widths) return e.widths;
  const blocked = riverEdgeBlocked(e);
  const step = e.len / e.count;
  const widths = new Float64Array(e.count + 1);
  for (let k = 0; k <= e.count; k++) widths[k] = e.wA + (e.wB - e.wA) * (k / e.count);
  const naturalEnd = (junction: string): number =>
    continuesAt(junction) ? RIVER_END_NONE : seedRand(`${domainConfig!.seed} - river end ${junction}`) < 0.5 ? RIVER_END_POND : RIVER_END_FIZZLE;
  for (let i0 = 0; i0 < e.count; ) {
    if (blocked[i0]) {
      i0++;
      continue;
    }
    let i1 = i0;
    while (i1 + 1 < e.count && !blocked[i1 + 1]) i1++;
    const startShape = i0 === 0 ? naturalEnd(e.keyA) : RIVER_END_POND;
    const endShape = i1 === e.count - 1 ? naturalEnd(e.keyB) : RIVER_END_POND;
    if (i0 === 0) e.endA = startShape !== RIVER_END_NONE;
    if (i1 === e.count - 1) e.endB = endShape !== RIVER_END_NONE;
    for (let k = i0; k <= i1 + 1; k++) {
      widths[k] *= riverEndShape(startShape, (k - i0) * step) * riverEndShape(endShape, (i1 + 1 - k) * step);
    }
    i0 = i1 + 1;
  }
  e.widths = widths;
  return widths;
};

/** The river grid's sites ±RIVER_GRID_RADIUS_CELLS around river cell (cx, cz), triangulated: each
 *  triangle's junction (its circumcenter), keyed by its three sites, and whether it is trusted. */
interface RiverWindow {
  tri: Uint32Array;
  halfedges: Int32Array;
  siteKey: (site: number) => string;
  junctionKey: string[];
  junctionX: number[];
  junctionZ: number[];
  trusted: boolean[];
}

const triangulateRiverWindow = (cx: number, cz: number): RiverWindow => {
  const G = RIVER_GRID_SIZE;
  const seed = domainConfig!.seed;
  const R = RIVER_GRID_RADIUS_CELLS;
  const siteIx: number[] = [];
  const siteIz: number[] = [];
  const coords: number[] = [];
  for (let ix = cx - R; ix <= cx + R; ix++) {
    for (let iz = cz - R; iz <= cz + R; iz++) {
      siteIx.push(ix);
      siteIz.push(iz);
      coords.push(RIVER_GRID_SHIFT.x + (ix + seedRand(`${seed} - river - ${ix}X${iz}`)) * G, RIVER_GRID_SHIFT.z + (iz + seedRand(`${seed} - river - ${ix}Z${iz}`)) * G);
    }
  }
  const delaunay = new Delaunator(coords);
  const tri = delaunay.triangles;
  const siteKey = (i: number) => `${siteIx[i]},${siteIz[i]}`;
  // Junctions keyed by their three SITES and computed from them in a canonical order: every
  // window that contains a junction produces it bit-identically.
  const junctionKey: string[] = [];
  const junctionX: number[] = [];
  const junctionZ: number[] = [];
  const trusted: boolean[] = [];
  const safeX0 = RIVER_GRID_SHIFT.x + (cx - R + 1) * G;
  const safeX1 = RIVER_GRID_SHIFT.x + (cx + R) * G;
  const safeZ0 = RIVER_GRID_SHIFT.z + (cz - R + 1) * G;
  const safeZ1 = RIVER_GRID_SHIFT.z + (cz + R) * G;
  for (let t = 0; t < tri.length / 3; t++) {
    const s = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]].sort((p, q) => siteIx[p] - siteIx[q] || siteIz[p] - siteIz[q]);
    const [ax, az, bx, bz, qx, qz] = [coords[s[0] * 2], coords[s[0] * 2 + 1], coords[s[1] * 2], coords[s[1] * 2 + 1], coords[s[2] * 2], coords[s[2] * 2 + 1]];
    const ad = ax * ax + az * az;
    const bd = bx * bx + bz * bz;
    const qd = qx * qx + qz * qz;
    const D = 2 * (ax * (bz - qz) + bx * (qz - az) + qx * (az - bz));
    junctionX.push((ad * (bz - qz) + bd * (qz - az) + qd * (az - bz)) / D);
    junctionZ.push((ad * (qx - bx) + bd * (ax - qx) + qd * (bx - ax)) / D);
    junctionKey.push(s.map(siteKey).join("/"));
    const jx = junctionX[t];
    const jz = junctionZ[t];
    const rad = Math.hypot(ax - jx, az - jz);
    trusted.push(jx - rad >= safeX0 && jx + rad <= safeX1 && jz - rad >= safeZ0 && jz + rad <= safeZ1);
  }
  return { tri, halfedges: delaunay.halfedges, siteKey, junctionKey, junctionX, junctionZ, trusted };
};

/** The edge `key` between junctions ja | jb of a window, or null where it rolls dry (its region's
 *  riverProbability) or is degenerate. Oriented from the junction with the smaller key. */
const newRiverEdge = (key: string, w: RiverWindow, ja: number, jb: number): RiverEdge | null => {
  const { junctionKey, junctionX, junctionZ } = w;
  if (junctionKey[jb] < junctionKey[ja]) [ja, jb] = [jb, ja];
  const mx = (junctionX[ja] + junctionX[jb]) / 2;
  const mz = (junctionZ[ja] + junctionZ[jb]) / 2;
  const region = nearestCell({ x: mx, z: mz }, getRegionGrid({ x: mx, z: mz })).element as SerializedRegion;
  if (seedRand(`${domainConfig!.seed} - river edge ${key}`) >= (riverKeepByRegion.get(region.id) ?? 0)) return null;
  const len = Math.hypot(junctionX[jb] - junctionX[ja], junctionZ[jb] - junctionZ[ja]);
  if (len < 1e-6) return null;
  const count = Math.max(1, Math.ceil(len / RIVER_SEGMENT_LENGTH));
  return {
    key,
    keyA: junctionKey[ja],
    keyB: junctionKey[jb],
    ax: junctionX[ja],
    az: junctionZ[ja],
    ux: (junctionX[jb] - junctionX[ja]) / len,
    uz: (junctionZ[jb] - junctionZ[ja]) / len,
    len,
    count,
    wA: riverJunctionWidth(junctionKey[ja], junctionX[ja], junctionZ[ja]),
    wB: riverJunctionWidth(junctionKey[jb], junctionX[jb], junctionZ[jb]),
    blocked: null,
    widths: null,
    along: new Int8Array(count).fill(-1),
    suppressed: new Int8Array(count).fill(-1),
    roadLayer: null,
    roadUnretracted: null,
    endA: false,
    endB: false,
    nearRoads: -1,
  };
};

/** The river network around a (warped) point: every built piece reaching the point's river cell
 *  ± RIVER_TRUST_MARGIN, warped space, before the road layer. Cached per river cell. */
export const riverCellEntry = (warped: PointXZ): RiverCellEntry => {
  if (!riversEnabled) return NO_RIVERS;
  const G = RIVER_GRID_SIZE;
  const cx = Math.floor((warped.x - RIVER_GRID_SHIFT.x) / G);
  const cz = Math.floor((warped.z - RIVER_GRID_SHIFT.z) / G);
  const cacheKey = `${cx},${cz}`;
  const cached = riverCache.get(cacheKey);
  if (cached) return cached;
  if (riverCache.size >= RIVER_CACHE_MAX) dropOldestHalf(riverCache);
  if (riverEdges.size > 16384) dropOldestHalf(riverEdges);

  const grid = triangulateRiverWindow(cx, cz);
  const { tri, halfedges: half, siteKey, trusted } = grid;
  const x0 = RIVER_GRID_SHIFT.x + cx * G - RIVER_TRUST_MARGIN;
  const x1 = RIVER_GRID_SHIFT.x + (cx + 1) * G + RIVER_TRUST_MARGIN;
  const z0 = RIVER_GRID_SHIFT.z + cz * G - RIVER_TRUST_MARGIN;
  const z1 = RIVER_GRID_SHIFT.z + (cz + 1) * G + RIVER_TRUST_MARGIN;
  const atJunction = new Map<string, RiverEdge[]>();
  const emitted: RiverEdge[] = [];
  for (let h = 0; h < half.length; h++) {
    const o = half[h];
    if (o === -1 || o < h) continue;
    const s1 = tri[h];
    const s2 = tri[h % 3 === 2 ? h - 2 : h + 1];
    const k1 = siteKey(s1);
    const k2 = siteKey(s2);
    const key = k1 < k2 ? `${k1}~${k2}` : `${k2}~${k1}`;
    if (!trusted[Math.floor(h / 3)] || !trusted[Math.floor(o / 3)]) continue;
    let e = riverEdges.get(key);
    if (!e) {
      const built = newRiverEdge(key, grid, Math.floor(h / 3), Math.floor(o / 3));
      if (!built) continue;
      riverEdges.set(key, (e = built));
    }
    for (const j of [e.keyA, e.keyB]) {
      const list = atJunction.get(j);
      if (list) list.push(e);
      else atJunction.set(j, [e]);
    }
    const bx = e.ax + e.ux * e.len;
    const bz = e.az + e.uz * e.len;
    if (Math.max(e.ax, bx) >= x0 && Math.min(e.ax, bx) <= x1 && Math.max(e.az, bz) >= z0 && Math.min(e.az, bz) <= z1) emitted.push(e);
  }

  // A junction continues the river when another built river leaves it (its piece there is built).
  const builtAt = (e: RiverEdge, junction: string): boolean => {
    const blocked = riverEdgeBlocked(e);
    return !blocked[junction === e.keyA ? 0 : e.count - 1];
  };
  const continuesAt = (self: RiverEdge) => (junction: string): boolean =>
    (atJunction.get(junction) ?? []).some((other) => other !== self && builtAt(other, junction));

  const entry: RiverCellEntry = { segments: [], edges: [] };
  for (const e of emitted) {
    const blocked = riverEdgeBlocked(e);
    const widths = riverEdgeWidths(e, continuesAt(e));
    const step = e.len / e.count;
    for (let i = 0; i < e.count; i++) {
      if (blocked[i]) continue;
      entry.segments.push({
        sx: e.ax + e.ux * i * step,
        sz: e.az + e.uz * i * step,
        ex: e.ax + e.ux * (i + 1) * step,
        ez: e.az + e.uz * (i + 1) * step,
        w0: widths[i],
        w1: widths[i + 1],
        edge: e.key,
        index: i,
      });
      entry.edges.push(e);
    }
  }
  riverCache.set(cacheKey, entry);
  return entry;
};

/** The river network's pieces around a (warped) point, before the road layer (see the file header). */
export const getRiverSegments = (warped: PointXZ): RiverSegment[] => riverCellEntry(warped).segments;

/** Network-build diagnostics (probes): pieces blocked per reason, over every edge built. */
export const riverDebug = { pieces: 0, blocked: [0, 0, 0, 0, 0], along: 0, undeckable: 0, retracted: 0 };

/** A built piece in the shape the per-vertex field and the bridges consume; resolveRiverPiece
 *  applies the road layer (which only ever removes pieces). */
export interface RiverPiece {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  w0: number;
  w1: number;
  edge: RiverEdge;
  index: number;
  resolved: boolean;
  suppressed: boolean;
}

/** The network's pieces around a point within `pad` of a box, BEFORE the road layer. */
export const riverPiecesRaw = (warped: PointXZ, minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverPiece[] => {
  const entry = riverCellEntry(warped);
  const out: RiverPiece[] = [];
  for (let j = 0; j < entry.segments.length; j++) {
    const s = entry.segments[j];
    if (Math.max(s.sx, s.ex) < minX - pad || Math.min(s.sx, s.ex) > maxX + pad || Math.max(s.sz, s.ez) < minZ - pad || Math.min(s.sz, s.ez) > maxZ + pad) continue;
    out.push({ sx: s.sx, sz: s.sz, ex: s.ex, ez: s.ez, w0: s.w0, w1: s.w1, edge: entry.edges[j], index: s.index, resolved: false, suppressed: false });
  }
  return out;
};

/** Applies the road layer to a piece (lazily — it needs the freeway network): false where the road wins. */
const resolveRiverPiece = (p: RiverPiece): boolean => {
  if (!p.resolved) {
    p.resolved = true;
    p.suppressed = riverPieceSuppressed(p.edge, p.index);
  }
  return !p.suppressed;
};

/** Piece i of an edge as the per-vertex field sees it (null where it is not built): the bridges walk
 *  a river along its edge, beyond any one window. The edge must have been emitted (its widths set). */
export const riverEdgePiece = (e: RiverEdge, i: number): RiverPiece | null => {
  if (!e.widths || riverEdgeBlocked(e)[i]) return null;
  const step = e.len / e.count;
  const p: RiverPiece = {
    sx: e.ax + e.ux * i * step,
    sz: e.az + e.uz * i * step,
    ex: e.ax + e.ux * (i + 1) * step,
    ez: e.az + e.uz * (i + 1) * step,
    w0: e.widths[i],
    w1: e.widths[i + 1],
    edge: e,
    index: i,
    resolved: false,
    suppressed: false,
  };
  return resolveRiverPiece(p) ? p : null;
};

/** Whether a built piece ENDS its river at its start / its end — a natural end, or the next piece is
 *  not built (unbuilt land, water, the road layer) — where a crossing count extends its centerline
 *  by the half-width (a pond's round end). Not at a junction the river goes on through. */
export const riverPieceEnds = (p: RiverPiece): [boolean, boolean] => {
  const e = p.edge;
  const i = p.index;
  const builtAt = (k: number) => !!riverEdgePiece(e, k);
  return [i === 0 ? e.endA : !builtAt(i - 1), i === e.count - 1 ? e.endB : !builtAt(i + 1)];
};

/** Whether a raw piece is built once the road layer has had its say (the per-vertex field's set). */
export const riverPieceBuilt = (p: RiverPiece): boolean => resolveRiverPiece(p);

export const riverPiecesIn = (warped: PointXZ, minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverPiece[] =>
  riverPiecesRaw(warped, minX, minZ, maxX, maxZ, pad).filter(resolveRiverPiece);

/** The widest a river's footprint (+ meander) can reach from its centerline, real units. */
export const riverMaxReach = (): number => riverKeepOff() * RIVER_WIDTH_MAX * RIVER_POND_FACTOR + RIVER_MEANDER_AMP;

/** The widest a river's WET field (riverSample.distance < halfWidth + bank) reaches from a raw
 *  piece, real units: the smooth minimum's dip, the widest width factor, the meander in both axes. */
export const riverWetReach = (): number => (riverKeepOff() + RIVER_FILLET / 4) * RIVER_WIDTH_MAX * RIVER_POND_FACTOR + 2 * RIVER_MEANDER_AMP;

/** Raw pieces from every river cell a warped box (+ pad) overlaps, each once (a cell emits whole
 *  edges, so an edge seen from one cell is complete). */
export const riverPiecesNear = (x0: number, z0: number, x1: number, z1: number, pad: number): RiverPiece[] => {
  const G = RIVER_GRID_SIZE;
  const out: RiverPiece[] = [];
  const seen = new Set<string>();
  for (let ix = Math.floor((x0 - pad - RIVER_GRID_SHIFT.x) / G); ix <= Math.floor((x1 + pad - RIVER_GRID_SHIFT.x) / G); ix++) {
    for (let iz = Math.floor((z0 - pad - RIVER_GRID_SHIFT.z) / G); iz <= Math.floor((z1 + pad - RIVER_GRID_SHIFT.z) / G); iz++) {
      const cell = { x: RIVER_GRID_SHIFT.x + (ix + 0.5) * G, z: RIVER_GRID_SHIFT.z + (iz + 0.5) * G };
      const fresh = new Set<string>();
      for (const p of riverPiecesRaw(cell, x0, z0, x1, z1, pad)) {
        if (seen.has(p.edge.key)) continue;
        fresh.add(p.edge.key);
        out.push(p);
      }
      for (const e of fresh) seen.add(e);
    }
  }
  return out;
};
