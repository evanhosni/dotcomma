/**
 * The per-vertex RIVER FIELD (layer 3 of riverNetwork.ts's header): distance in factor-1 units,
 * width factor and water surface at a warped point, and the straight-point variant the city's quay
 * roads follow. Evaluated from per-biome-cell lists of the pieces that can reach the cell.
 */

import { smoothstep } from "../../math/_math";
import { CellCache, dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { lakeSurface, lastShore, riverMouthShare, riverSurfaceBesideCrispShore } from "../lakes";
import { simplex2, unwarp } from "../noise";
import { getNetwork } from "../roads/freewayNetwork";
import { RIVER_FILLET, RIVER_MEANDER_AMP, RIVER_MEANDER_SCALE, RIVER_SURFACE_BELOW, type RiverEdge, type RiverGorge, type RiverPiece, riverMaxReach, riverPiecesIn, riversEnabled } from "./riverNetwork";
import type { RiverQuaySample } from "../types";
import { blendedTerrainAt, carveRiverChannel } from "../vertexCompute";
import { RIVER_BED_FULL_INSET, RIVER_BED_SLOPE_START_DEG } from "../../../world/shaders/constants";
import { getBiomeContext, cityWallsOf } from "../voronoi";
import { accumulateWallFields, combineZoneWeights, zoneFinal, zoneWeights } from "../zoneBlend";

// ── The water surface ──────────────────────────────────────────────────

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
      const approach = smoothstep(0, RIVER_MOUTH_APPROACH, shore.dWater);
      h = shore.level + Math.max(0, h - shore.level) * (shore.fade === 1 ? approach : 1 - (1 - approach) * shore.fade);
    }
    riverSurfaceCache.set(key, h);
  }
  return h;
};

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
const setShoreAt = (wx: number, wz: number): void => {
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
const edgeCrossings = new Map<string, { s: number; cap: number }[]>();
const edgeCrossingsOf = (e: RiverEdge): { s: number; cap: number }[] => {
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
        const f = e.widths ? e.widths[k] + (e.widths[k + 1] - e.widths[k]) * t : 1;
        const out = reach * f + RIVER_MEANDER_AMP + RIVER_ROAD_LANDING_PAST;
        const p = alongRoad(legs, i, u, out, true);
        const q = alongRoad(legs, i, u, out, false);
        // The landing grades are lifted with the shore of the crossing itself, set here: left to whatever
        // the last lakeSurface stored, the cap would depend on evaluation order.
        setShoreAt(x, z);
        const low = Math.min(roadGradeAt(p.x, p.z), roadGradeAt(q.x, q.z));
        list.push({ s: along, cap: low - RIVER_ROAD_CLEARANCE });
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
 *  near it): each crossing's cap over the two piece ends beside it, rising RIVER_CAP_GRADE per unit along
 *  the river past them. A function of the edge and the roads alone, so the pieces sharing an end agree. */
const roadCapCache = new Map<string, number>();
const roadCrossingCap = (e: RiverEdge, k: number): number => {
  const key = `${e.key}:${k}`;
  let cap = roadCapCache.get(key);
  if (cap !== undefined) return cap;
  if (roadCapCache.size > 16384) dropOldestHalf(roadCapCache);
  cap = Infinity;
  const step = e.len / e.count;
  for (const c of edgeCrossingsOf(e)) cap = Math.min(cap, c.cap + RIVER_CAP_GRADE * Math.max(0, Math.abs(k * step - c.s) - step));
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
  const own = Math.min(riverSurfaceAt(g.bx, g.bz), roadCrossingCap(e, g.from));
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

/** A piece end's surface: a gorge's, else the terrain's (riverSurfaceAt) under any freeway crossing beside it. */
const pieceEndSurface = (p: RiverPiece, which: 0 | 1): number => {
  const k = p.index + which;
  for (const g of p.edge.gorges) {
    if (k !== g.from && (k - g.from) * (k - g.to) <= 0) return gorgeSurfaces(p.edge, g)[Math.abs(k - g.from)];
  }
  const h = which === 0 ? riverSurfaceAt(p.sx, p.sz) : riverSurfaceAt(p.ex, p.ez);
  return Math.min(h, roadCrossingCap(p.edge, p.index + which));
};

// ── Where the riverbed ends ────────────────────────────────────────────

/** The bed ENDS where its bank first gets as steep as the shader starts fading it out
 *  (RIVER_BED_SLOPE_START_DEG): past it the bed never resumes — by the per-pixel fade alone, wherever
 *  the bank flattened again within reach a patch of riverbed showed, cut off from the river by rock. */
const RIVER_BED_END_SLOPE = Math.tan((RIVER_BED_SLOPE_START_DEG * Math.PI) / 180);
/** The bank profile's sample spacing, real units (each sample is a wall pass, once per station). */
const RIVER_BED_MARCH_STEP = 3;
/** The paint fades out over this many factor-1 units inward of the limit (capRiverBed), at least two LOD1
 *  vertex spacings: over 4 the cut-off edge traced the triangles. */
const RIVER_BED_CAP_FADE = 8;
/** Beside a city the bed limit is found past the river's reach, wherever a city vertex's bed distance
 *  (the straight one, RIVER_BED_FULL_INSET in) can still be inside it: the meandered field lies within
 *  the meander (2 × RIVER_MEANDER_AMP, ±10u on each axis) and a margin of it — this many REAL units
 *  past reach + inset (a fizzle's width factor of 0.2 puts that 70 factor-1 units out). A literal: a
 *  pipeline module's export read at the top level is not yet initialized in every bundle's order. */
const RIVER_BED_LIMIT_PAST = 30;

/** The bank at warped point (px, pz) as step 4 carves it: the terrain there (its own wall pass and
 *  shore) under the FULL river field of the point's own piece list — every river near it, confluences
 *  and ponds included (one river's profile alone missed the banks a second river shapes) — a mouth's
 *  lakebed only deepened. Sets bankSample: the field's distance, and the height, NaN where the point is
 *  in a river's water (the bed goes on there: it is that river's). Clobbers the wall-pass scratch and
 *  the edge scratch. */
const bankSample = { height: NaN, distance: Infinity };
const bankAt = (px: number, pz: number): void => {
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

/** Bed STATIONS per river piece (every RIVER_SEGMENT_LENGTH / 4 = 12.5u along an edge): one march per
 *  piece end missed banks that steepen between them. */
const BED_STATIONS = 4;
/** Marches in the fan past a piece's end, strictly between its two sides (30° apart). */
const BED_FAN = 5;

/** How far out (factor-1 units, the riverbed paint's distance) the bed reaches from station q of edge e
 *  (q / BED_STATIONS pieces along it) marching along (dx, dz) — the bed's own reach when the bank never
 *  gets steep within it, so a limit fades back to none along the river from a steep station to a flat
 *  one (a far "no limit" value swamped every limit it was interpolated with). The march runs from the
 *  channel's edge out to the bed's reach on the vertex field's own distance; the limit is that distance
 *  at the end of the first steep step out of the water. A function of the edge, the station and the
 *  direction only (cached by `key`), so every chunk agrees. Clobbers the wall-pass and edge scratch. */
const bedLimitCache = new Map<string, number>();
const bedLimitAlong = (e: RiverEdge, q: number, dx: number, dz: number, key: string): number => {
  let limit = bedLimitCache.get(key);
  if (limit !== undefined) return limit;
  if (bedLimitCache.size > 65536) dropOldestHalf(bedLimitCache);
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  limit = reach;
  const k = Math.min(e.count - 1, Math.floor(q / BED_STATIONS));
  const u = q / BED_STATIONS - k;
  const step = e.len / e.count;
  const sx = e.ax + e.ux * (k + u) * step;
  const sz = e.az + e.uz * (k + u) * step;
  const f = e.widths ? e.widths[k] + (e.widths[k + 1] - e.widths[k]) * u : 1;
  let prevH = NaN;
  let prevX = 0;
  let prevZ = 0;
  for (let d = rv.halfWidth * f; d <= reach * f + RIVER_MEANDER_AMP; d += RIVER_BED_MARCH_STEP) {
    const px = sx + dx * d;
    const pz = sz + dz * d;
    // The slope across the march too (the shader fades by the whole gradient): the bank one step aside.
    bankAt(px + dz * RIVER_BED_MARCH_STEP, pz - dx * RIVER_BED_MARCH_STEP);
    const hAside = bankSample.height;
    const asideWorld = unwarp(px + dz * RIVER_BED_MARCH_STEP, pz - dx * RIVER_BED_MARCH_STEP);
    bankAt(px, pz);
    if (!(bankSample.distance < reach)) break;
    const h = bankSample.height;
    const world = unwarp(px, pz);
    if (!Number.isNaN(h)) {
      const along = Number.isNaN(prevH) ? 0 : (h - prevH) / Math.hypot(world.x - prevX, world.z - prevZ);
      const aside = Number.isNaN(hAside) ? 0 : (hAside - h) / Math.hypot(asideWorld.x - world.x, asideWorld.z - world.z);
      if (Math.hypot(along, aside) > RIVER_BED_END_SLOPE) {
        // Never inside the half-width, where the channel is: the bed limit is read only from there out.
        limit = Math.max(rv.halfWidth, bankSample.distance);
        break;
      }
    }
    prevH = h;
    prevX = world.x;
    prevZ = world.z;
  }
  bedLimitCache.set(key, limit);
  return limit;
};

/** Station q's limit on the edge's left (side +1, (−uz, ux)) or right (−1). */
const bedLimitSide = (e: RiverEdge, q: number, side: 1 | -1): number =>
  bedLimitAlong(e, q, -e.uz * side, e.ux * side, `${e.key}:${q}:${side > 0 ? "L" : "R"}`);
/** Past station q (a piece end) going out along the edge (`out` +1 past an end, −1 before a start): the
 *  fan's march m (1…BED_FAN, from the right side toward the left). Where a next piece of the edge goes
 *  on, it is nearer than this one past the end except where this piece is the wider (a pond end), and
 *  at a river's end or an edge's (a junction's wedges) nothing else is: the fan covers both. */
const bedLimitFan = (e: RiverEdge, q: number, out: 1 | -1, m: number): number => {
  const a = Math.PI * (m / (BED_FAN + 1) - 0.5);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return bedLimitAlong(e, q, e.ux * out * c - e.uz * sn, e.uz * out * c + e.ux * sn, `${e.key}:${q}:${out > 0 ? "F" : "B"}${m}`);
};

/** The bed limit of list piece j at the vertex: `t` along the piece (clamped), `sideCos` the sine of
 *  the vertex's angle off the edge (+ = left), `outCos` its cosine past a clamped end. Inside the piece,
 *  the two stations around t on the vertex's side (blended across the centerline, where no limit is
 *  reached); past an end, that end's fan by the angle, between the side limits at ±90° — continuous with
 *  the sides on the end's line. Lazily marched, so only stations some vertex needs are ever walked. */
const bedLimitOfPiece = (p: RiverPiece, t: number, sideCos: number, outCos: number): number => {
  const e = p.edge;
  const q0 = p.index * BED_STATIONS;
  if ((t === 0 || t === 1) && outCos > 1e-9) {
    const q = t === 0 ? q0 : q0 + BED_STATIONS;
    const out = t === 0 ? -1 : 1;
    // 0 (right side) … BED_FAN + 1 (left side), one step per fan march.
    const a = (Math.atan2(sideCos, outCos) / Math.PI + 0.5) * (BED_FAN + 1);
    const i = Math.min(BED_FAN, Math.floor(a));
    const node = (m: number) => (m === 0 ? bedLimitSide(e, q, -1) : m === BED_FAN + 1 ? bedLimitSide(e, q, 1) : bedLimitFan(e, q, out, m));
    const n0 = node(i);
    return n0 + (node(i + 1) - n0) * (a - i);
  }
  const st = Math.min(BED_STATIONS - 1, Math.floor(t * BED_STATIONS));
  const w = t * BED_STATIONS - st;
  const side = smoothstep(-0.5, 0.5, sideCos);
  let limit = 0;
  if (side < 1) {
    const r0 = bedLimitSide(e, q0 + st, -1);
    limit += (r0 + (bedLimitSide(e, q0 + st + 1, -1) - r0) * w) * (1 - side);
  }
  if (side > 0) {
    const l0 = bedLimitSide(e, q0 + st, 1);
    limit += (l0 + (bedLimitSide(e, q0 + st + 1, 1) - l0) * w) * side;
  }
  return limit;
};

/** The riverbed paint distance capped at the bed's limit (riverSample.bedLimit): beyond the limit
 *  the point reads as out of the bed's reach, fading over RIVER_BED_CAP_FADE inward of it. Unchanged
 *  where no limit lies within reach (every flat bank). */
export const capRiverBed = (bed: number, limit: number): number => {
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  if (limit >= reach) return bed;
  return bed + (reach - limit) * smoothstep(limit - RIVER_BED_CAP_FADE, limit, bed);
};

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
    list.h0[j] = pieceEndSurface(p, 0);
    list.h1[j] = pieceEndSurface(p, 1);
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
 *  Infinity where no river is in reach — capRiverBed). */
export const riverSample = { distance: Infinity, factor: 1, surface: NaN, bedLimit: Infinity };
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
};

/** What the last fieldFromList found (riverSample's fields). */
let fieldDist = Infinity;
let fieldFactor = 1;
let fieldSurface = NaN;

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
  if (list.n === 0) return;
  const qx = px + RIVER_MEANDER_AMP * simplex2(px / RIVER_MEANDER_SCALE, pz / RIVER_MEANDER_SCALE);
  const qz = pz + RIVER_MEANDER_AMP * simplex2(pz / RIVER_MEANDER_SCALE + 7.31, px / RIVER_MEANDER_SCALE - 3.17);
  scanPieces(list, qx, qz, false);
  edgeSmoothMin(edgeDist, list.groups);
  const sum = runSmoothWeights(list.runs, list.groups);
  let wf = 0;
  let ws = 0;
  for (let r = 0; r < list.runs; r++) {
    if (runWeight[r] === 0) continue;
    wf += runWeight[r] * runFactor[r];
    ws += runWeight[r] * runSurface[r];
  }
  fieldDist = smoothMinDist;
  fieldFactor = wf / sum;
  fieldSurface = ws / sum;
};

// The runs a vertex's bed limit blends (riverFieldAt), copied out of the run scratch the marches clobber.
const limitPiece: RiverPiece[] = [];
let limitT = new Float64Array(16);
let limitSideCos = new Float64Array(16);
let limitOutCos = new Float64Array(16);
let limitWeight = new Float64Array(16);

/** Sets riverSample for a warped point: fieldFromList over the point's cell list. `besideCity`: the bed
 *  limit is wanted past the river's reach too (the city's quay rule paints the bed there). */
export const riverFieldAt = (px: number, pz: number, besideCity = false): void => {
  noRiverSample();
  if (!riversEnabled) return;
  const list = riverCellList(px, pz);
  if (list.n === 0) return;
  fieldFromList(list, px, pz);
  riverSample.distance = fieldDist;
  riverSample.factor = fieldFactor;
  riverSample.surface = fieldSurface;
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
  roadCapCache.clear();
  gorgeSurfaceCache.clear();
  edgeCrossings.clear();
  riverCellLists.clear();
  lastRiverCellList = null;
  riverSurfaceCache.clear();
  bedLimitCache.clear();
};

/** A piece end's river surface as the field draws it (tests and probes). */
export const riverPieceEndSurface = (p: RiverPiece, which: 0 | 1): number => pieceEndSurface(p, which);
/** …and the terrain's own surface there, before any road crossing caps it. */
export const riverPieceEndTerrainSurface = (p: RiverPiece, which: 0 | 1): number => (which === 0 ? riverSurfaceAt(p.sx, p.sz) : riverSurfaceAt(p.ex, p.ez));
