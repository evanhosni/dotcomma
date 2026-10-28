/**
 * The river's water SURFACE at its piece ends (CLAUDE.md "Rivers", the per-vertex field): the terrain
 * at the centerline less RIVER_SURFACE_BELOW, eased onto a lake's level near one, capped under every
 * freeway crossing, and run straight and downhill through a gorge. The per-vertex field interpolates
 * it along each piece, so it is a function of the centerline only.
 */

import { smoothstep } from "../../math";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { lakeSurface, lastShore, lastShoreDistance, riverLakeCloseness } from "../lakes";
import { unwarp } from "../noise";
import { getNetwork } from "../roads/freewayNetwork";
import { blendedTerrainAt } from "../vertexCompute";
import { cityWallsOf, getBiomeContext } from "../voronoi";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights } from "../zoneBlend";
import { RIVER_MEANDER_AMP, RIVER_SURFACE_BELOW } from "./constants";
import { riverEdgeBlocked } from "./riverPieceRules";
import type { RiverEdge, RiverGorge, RiverPiece } from "./types";

/** A river reaching a lake settles onto its level over this far from the lake's wall (real units):
 *  hung from the terrain alone, a mouth's surface can stand ~11u over the lake at the wall and drop to
 *  it over one 50u piece — a stepped sheet of water. */
const RIVER_MOUTH_APPROACH = 250;

/** Surface at a (warped) CENTERLINE point: the terrain there — its own wall pass, the city at its
 *  plateau FLOOR (so no block stands under the surface), lifted with a lake's
 *  shore — minus RIVER_SURFACE_BELOW. Near a lake it eases onto the lake's level (never below it on
 *  land, never above it in the water — there the channel stays sunk under the lake, or its bank
 *  rule would raise a levee across the lakebed). Runs before the calling vertex's own wall pass (it
 *  clobbers the scratch), never recurses into rivers, and is cached per point. */
/** Per point: [surface, the signed distance to its nearest water wall (lakes.ts lastShoreDistance —
 *  what riverLakeMerge measures a river's gap to a lake by), the lake level there (NaN where none), and
 *  how far that level reaches it (0–1)]. */
const riverPointCache = new Map<string, [number, number, number, number]>();
const riverPointAt = (wx: number, wz: number): [number, number, number, number] => {
  const key = `${wx},${wz}`;
  let point = riverPointCache.get(key);
  if (point === undefined) {
    if (riverPointCache.size > 16384) dropOldestHalf(riverPointCache);
    const warped = { x: wx, z: wz };
    const ctx = getBiomeContext(warped);
    accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
    combineZoneWeights(zoneWeights, zoneFinal);
    const inLake = lakeSurface(warped, ctx, ctx.zone);
    const shore = lastShore();
    const shoreDistance = lastShoreDistance();
    const world = unwarp(wx, wz);
    let h = blendedTerrainAt(world.x, world.z, ctx.zone, ctx, 0) - RIVER_SURFACE_BELOW;
    if (ctx.zone.biome.water) {
      if (!Number.isNaN(inLake)) h = Math.min(h, inLake);
    } else if (!Number.isNaN(shore.level)) {
      const approach = smoothstep(0, RIVER_MOUTH_APPROACH, shore.dWater);
      h = shore.level + Math.max(0, h - shore.level) * (shore.fade === 1 ? approach : 1 - (1 - approach) * shore.fade);
    }
    point = [h, shoreDistance, ctx.zone.biome.water ? inLake : shore.level, ctx.zone.biome.water ? 1 : shore.fade];
    riverPointCache.set(key, point);
  }
  return point;
};
const riverSurfaceAt = (wx: number, wz: number): number => riverPointAt(wx, wz)[0];

// ── Roads over the river ───────────────────────────────────────────────

/** A freeway crossing a river — an inter-city run, a city's belt — is decked flat from its road on
 *  one bank to its road on the other, so the surface where it crosses stands this far under the
 *  lower of its two landings (the deck lifts 1u off the road and clears the water by 4.5 —
 *  bridges' BRIDGE_DECK_LIFT and BRIDGE_WATER_CLEARANCE — plus a margin). Without it a river along a
 *  crest above the valleys a road comes through would raise its banks as a levee the road must climb,
 *  with a deck arch too high to build. */
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
export const setShoreAt = (wx: number, wz: number): void => {
  const warped = { x: wx, z: wz };
  const ctx = getBiomeContext(warped);
  accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, ctx, ctx.zone);
};

/** A road's leg: a warped segment (ax, az) → (bx, bz). */
type RoadLeg = [number, number, number, number];
/** How far along the road from the point at fraction `t` of leg `i` (toward its end when `forward`, else
 *  its start) a distance `dist` lands, continuing onto the leg that starts where this one ends (the most
 *  nearly straight one, never the same leg reversed) and stopping where the road does: a point ON the
 *  road. Walls are listed both ways round, so one search serves either direction. */
const alongRoad = (legs: RoadLeg[], i: number, t: number, dist: number, forward: boolean): { x: number; z: number } => {
  let [ax, az, bx, bz] = legs[i];
  if (!forward) [ax, az, bx, bz] = [bx, bz, ax, az];
  let px = ax + (bx - ax) * (forward ? t : 1 - t);
  let pz = az + (bz - az) * (forward ? t : 1 - t);
  let left = dist;
  for (let hops = 0; hops < 64; hops++) {
    const len = Math.hypot(bx - px, bz - pz);
    if (len >= left) return { x: px + ((bx - px) * left) / len, z: pz + ((bz - pz) * left) / len };
    left -= len;
    const ux = (bx - ax) / (Math.hypot(bx - ax, bz - az) || 1);
    const uz = (bz - az) / (Math.hypot(bx - ax, bz - az) || 1);
    let next: RoadLeg | null = null;
    let best = -Infinity;
    for (const l of legs) {
      for (const [sx, sz, ex, ez] of [l, [l[2], l[3], l[0], l[1]]]) {
        if (Math.abs(sx - bx) > 1e-6 || Math.abs(sz - bz) > 1e-6 || (Math.abs(ex - ax) < 1e-6 && Math.abs(ez - az) < 1e-6)) continue;
        const ll = Math.hypot(ex - sx, ez - sz) || 1;
        const dot = ((ex - sx) * ux + (ez - sz) * uz) / ll;
        if (dot > best) {
          best = dot;
          next = [sx, sz, ex, ez];
        }
      }
    }
    if (!next) return { x: bx, z: bz };
    [ax, az, bx, bz] = next;
    px = ax;
    pz = az;
  }
  return { x: px, z: pz };
};

/** Every freeway (run, belt) crossing edge e: where along the edge, and the highest the surface may stand
 *  there — RIVER_ROAD_CLEARANCE under the lower of its two landings. The landings are sampled ALONG THE
 *  ROAD (alongRoad), RIVER_ROAD_LANDING_PAST past the footprint: straight on along the crossing leg, a
 *  belt turning at a corner beside the river left its road, and a grade read off the road there (36u
 *  under it, MEASURED at (-1551, 1084)) sank the river into a gorge. Per edge, a pure function of it. */
/** How the road's wet span is walked from a crossing (real units): the step, and the farthest (a road
 *  running along a river for longer than this is the road layer's: it gives the river way). */
const WET_WALK_STEP = 8;
const WET_WALK_MAX = 600;
/** A freeway's crossing of an edge: the range of the edge (arc, warped units) the road shadows while
 *  it is inside the river's footprint, and the highest the surface may stand across it. */
interface EdgeCrossing {
  s0: number;
  s1: number;
  cap: number;
}
const edgeCrossings = new Map<string, EdgeCrossing[]>();
const edgeCrossingsOf = (e: RiverEdge): EdgeCrossing[] => {
  let list = edgeCrossings.get(e.key);
  if (list) return list;
  if (edgeCrossings.size > 4096) dropOldestHalf(edgeCrossings);
  list = [];
  const step = e.len / e.count;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const seen = new Set<string>();
  for (let k = 0; k < e.count; k++) {
    const ax = e.ax + e.ux * k * step;
    const az = e.az + e.uz * k * step;
    const bx = ax + e.ux * step;
    const bz = az + e.uz * step;
    const mid = { x: (ax + bx) / 2, z: (az + bz) / 2 };
    const roads: RoadLeg[][] = [];
    for (const run of getNetwork(mid).freeways) {
      if (run.maxX < Math.min(ax, bx) || run.minX > Math.max(ax, bx) || run.maxZ < Math.min(az, bz) || run.minZ > Math.max(az, bz)) continue;
      const legs: RoadLeg[] = [];
      for (let j = 0; j + 3 < run.pts.length; j += 2) legs.push([run.pts[j], run.pts[j + 1], run.pts[j + 2], run.pts[j + 3]]);
      roads.push(legs);
    }
    roads.push(cityWallsOf(getBiomeContext(mid)).map((w): RoadLeg => [w.sx, w.sz, w.ex, w.ez]));
    for (const legs of roads) {
      for (let i = 0; i < legs.length; i++) {
        const [cx, cz, dx2, dz2] = legs[i];
        const rx = bx - ax;
        const rz = bz - az;
        const sx = dx2 - cx;
        const sz = dz2 - cz;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * sz - (cz - az) * sx) / den;
        const u = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const x = ax + rx * t;
        const z = az + rz * t;
        // (A wall is listed both ways round; a crossing on a piece end belongs to both pieces.)
        const id = `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const along = (k + t) * step;
        // The road's WET SPAN: walked along the road both ways from the crossing until it leaves the
        // river's footprint (a road crossing obliquely, or running beside a descending river, stays
        // inside it for hundreds of units), recording the range of the edge it shadows; the landings are
        // RIVER_ROAD_LANDING_PAST past where it leaves. A cap at the crossing point alone left the water
        // 160u under a deck landing at 137 (-6400, 8930): dropped for clearance, the run severed.
        let s0 = along;
        let s1 = along;
        const exits: { x: number; z: number }[] = [];
        for (const forward of [true, false]) {
          let exit = 0;
          for (let d = WET_WALK_STEP; d <= WET_WALK_MAX; d += WET_WALK_STEP) {
            const r = alongRoad(legs, i, u, d, forward);
            const s = Math.max(0, Math.min(e.len, (r.x - e.ax) * e.ux + (r.z - e.az) * e.uz));
            const off = Math.hypot(r.x - (e.ax + e.ux * s), r.z - (e.az + e.uz * s));
            const wf = e.widths ? e.widths[Math.min(e.count - 1, Math.floor(s / step))] : 1;
            exit = d;
            if (off > reach * wf + RIVER_MEANDER_AMP) break;
            if (s < s0) s0 = s;
            if (s > s1) s1 = s;
          }
          exits.push(alongRoad(legs, i, u, exit + RIVER_ROAD_LANDING_PAST, forward));
        }
        // The landing grades are lifted with the shore of the crossing itself, set here: left to whatever
        // the last lakeSurface stored, the cap would depend on evaluation order.
        setShoreAt(x, z);
        const low = Math.min(roadGradeAt(exits[0].x, exits[0].z), roadGradeAt(exits[1].x, exits[1].z));
        list.push({ s0, s1, cap: low - RIVER_ROAD_CLEARANCE });
      }
    }
  }
  edgeCrossings.set(e.key, list);
  return list;
};

/** The surface eases toward a crossing's cap at no more than this rise per unit along the river (6u
 *  per 50u piece): a cap squeezed into the one piece beside it dropped the water 36u at once. */
const RIVER_CAP_GRADE = 0.12;

/** The highest the surface may stand at edge e's piece end k (Infinity when no freeway crosses the edge
 *  near it): each crossing's cap over the piece ends within its wet span and the one beside it either
 *  way, rising RIVER_CAP_GRADE per unit along the river past them. A function of the edge and the roads
 *  alone, so the pieces sharing an end agree. */
const roadCapCache = new Map<string, number>();
const roadCrossingCap = (e: RiverEdge, k: number): number => {
  const key = `${e.key}:${k}`;
  let cap = roadCapCache.get(key);
  if (cap !== undefined) return cap;
  if (roadCapCache.size > 16384) dropOldestHalf(roadCapCache);
  cap = Infinity;
  const step = e.len / e.count;
  const s = k * step;
  for (const c of edgeCrossingsOf(e)) {
    const outside = s < c.s0 ? c.s0 - s : s > c.s1 ? s - c.s1 : 0;
    cap = Math.min(cap, c.cap + RIVER_CAP_GRADE * Math.max(0, outside - step));
  }
  roadCapCache.set(key, cap);
  return cap;
};

/** A GORGE's surface (riverNetwork's junction gaps) at each of its piece ends, `from` to `to`: straight
 *  from the water where the edge's own river stops to the junction's water, never uphill over the ridge
 *  between, which the channel then cuts like any bank (carveRiverChannel). Under a freeway crossing
 *  beside it as anywhere (roadCrossingCap), and then the running minimum from its higher end: a cap
 *  easing back up along the gorge would run the water uphill. Per edge and end, cached. */
const gorgeSurfaceCache = new Map<string, Float64Array>();
const gorgeSurfaces = (e: RiverEdge, g: RiverGorge): Float64Array => {
  const key = `${e.key}:${g.from}:${g.to}`;
  let s = gorgeSurfaceCache.get(key);
  if (s) return s;
  if (gorgeSurfaceCache.size > 4096) dropOldestHalf(gorgeSurfaceCache);
  const n = Math.abs(g.to - g.from);
  const dir = g.to > g.from ? 1 : -1;
  // The river's end as its piece end draws it: a peak pool's level where one lies there, else the
  // surface eased onto a lake beside it (beside the snow's rise the land stood 17u over the lake, and
  // a gorge starting from the raw surface ran uphill into the eased end).
  const own = Math.min(riverEdgePools(e).get(g.from) ?? easedSurfaceAt(g.bx, g.bz, e.widths ? e.widths[g.from] : 1), roadCrossingCap(e, g.from));
  let junction: number;
  if (g.pair) {
    const p = riverSurfaceAt(g.px, g.pz);
    junction = p + (riverSurfaceAt(g.qx, g.qz) - p) * g.share;
  } else junction = riverSurfaceAt(g.jx, g.jz);
  junction = Math.min(junction, roadCrossingCap(e, g.to));
  s = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) s[i] = Math.min(own + (junction - own) * (i / n), roadCrossingCap(e, g.from + dir * i));
  if (own >= junction) for (let i = 1; i <= n; i++) s[i] = Math.min(s[i], s[i - 1]);
  else for (let i = n - 1; i >= 1; i--) s[i] = Math.min(s[i], s[i + 1]);
  gorgeSurfaceCache.set(key, s);
  return s;
};

// ── Peak pools ────────────────────────────────────────────────────────────

/** A pool forms at a peak that stands at least this much above its surroundings along the river. */
const RIVER_POOL_PROMINENCE = 5;
/** The pool's two outer ends stand this grade under the peak's level (never under their own surface): a
 *  slow pool sloping off the peak, not a shelf of still water with a terrace cut around it (Evan:
 *  "a little flat at the top"). */
const RIVER_POOL_TOP_GRADE = 0.03;

/** The PEAK POOLS of an edge (CLAUDE.md "Rivers"): on the rock a river runs over the mountain, and at
 *  every local maximum of its terrain surface along the edge (prominence RIVER_POOL_PROMINENCE over
 *  the two piece ends either side) its three piece ends around the peak share the peak's level, the
 *  outer two RIVER_POOL_TOP_GRADE under it:
 *  a pool the channel carve banks on the downhill sides (carveRiverChannel raises low ground to the
 *  rim), with the water falling from its edge to the next piece end's surface. By end index → level,
 *  the higher peak winning where two overlap. Per edge, cached (the surfaces are per point, cached too). */
const edgePools = new Map<string, Map<number, number>>();
const NO_POOLS: ReadonlyMap<number, number> = new Map();
export const riverEdgePools = (e: RiverEdge): ReadonlyMap<number, number> => {
  let pools = edgePools.get(e.key);
  if (pools) return pools;
  const rock = e.rock;
  if (!rock || !rock.some((r) => r === 1)) return NO_POOLS;
  if (edgePools.size > 4096) dropOldestHalf(edgePools);
  pools = new Map();
  const blocked = riverEdgeBlocked(e);
  const n = e.count;
  const step = e.len / n;
  const s = new Float64Array(n + 1).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (blocked[i] !== 0 || rock[i] !== 1) continue;
    for (const k of [i, i + 1]) if (Number.isNaN(s[k])) s[k] = riverSurfaceAt(e.ax + e.ux * k * step, e.az + e.uz * k * step);
  }
  const peaks: number[] = [];
  for (let k = 1; k < n; k++) {
    if (Number.isNaN(s[k - 1]) || Number.isNaN(s[k]) || Number.isNaN(s[k + 1])) continue;
    if (!(s[k] > s[k - 1] && s[k] >= s[k + 1])) continue;
    let low = Infinity;
    for (let j = Math.max(0, k - 2); j <= Math.min(n, k + 2); j++) if (!Number.isNaN(s[j]) && s[j] < low) low = s[j];
    if (s[k] - low >= RIVER_POOL_PROMINENCE) peaks.push(k);
  }
  peaks.sort((a, b) => s[b] - s[a]);
  for (const k of peaks) {
    for (const j of [k - 1, k, k + 1]) {
      if (pools.has(j)) continue;
      pools.set(j, j === k ? s[k] : Math.max(s[j], s[k] - RIVER_POOL_TOP_GRADE * step));
    }
  }
  edgePools.set(e.key, pools);
  return pools;
};

/** A piece end's surface: a gorge's, a peak pool's level, else the terrain's (riverSurfaceAt) under
 *  any freeway crossing beside it. */
export const riverPieceEndSurface = (p: RiverPiece, which: 0 | 1): number => {
  const k = p.index + which;
  for (const g of p.edge.gorges) {
    if (k !== g.from && (k - g.from) * (k - g.to) <= 0) return gorgeSurfaces(p.edge, g)[Math.abs(k - g.from)];
  }
  const pool = riverEdgePools(p.edge).get(k);
  if (pool !== undefined) return Math.min(pool, roadCrossingCap(p.edge, k));
  const h = which === 0 ? easedSurfaceAt(p.sx, p.sz, p.w0) : easedSurfaceAt(p.ex, p.ez, p.w1);
  return Math.min(h, roadCrossingCap(p.edge, p.index + which));
};

/** The terrain surface at a warped centerline point of a river of width `factor`, eased onto a lake's
 *  level beside it: close enough for the land between to merge (riverLakeMerge), the surface settles
 *  onto the level, so the two waters meet without a step. */
const easedSurfaceAt = (wx: number, wz: number, factor: number): number => {
  const [surface, shore, level, fade] = riverPointAt(wx, wz);
  if (!(surface > level)) return surface;
  return level + (surface - level) * (1 - fade * riverLakeCloseness(shore, factor, domainConfig!.river, true));
};

/** A piece end's centerline signed water-wall distance (riverSurfaceAt measures it with the surface). */
export const riverPieceEndShore = (p: RiverPiece, which: 0 | 1): number => (which === 0 ? riverPointAt(p.sx, p.sz) : riverPointAt(p.ex, p.ez))[1];
/** …and the lake level there (its terrain surface where none, so the field can blend it: no lake is
 *  close enough there for riverLakeMerge to read it). */
export const riverPieceEndLevel = (p: RiverPiece, which: 0 | 1): number => {
  const point = which === 0 ? riverPointAt(p.sx, p.sz) : riverPointAt(p.ex, p.ez);
  return Number.isNaN(point[2]) ? point[0] : point[2];
};

/** …and the terrain's own surface there, before any road crossing caps it (tests and probes). */
export const riverPieceEndTerrainSurface = (p: RiverPiece, which: 0 | 1): number => (which === 0 ? riverSurfaceAt(p.sx, p.sz) : riverSurfaceAt(p.ex, p.ez));

export const clearRiverSurfaces = (): void => {
  roadCapCache.clear();
  gorgeSurfaceCache.clear();
  edgePools.clear();
  edgeCrossings.clear();
  riverPointCache.clear();
};
