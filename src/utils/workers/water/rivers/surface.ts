/**
 * The river's WATER SURFACE at every joint of an edge (water/DECISIONS.md "The per-vertex field"): the
 * field interpolates it along the river, so it is level across the channel.
 *
 * At a joint it is the ground under the footprint (../utils.ts waterGroundAt: zone-blended, without
 * roads, a <Quays/> biome at its floor, lifted with a lake's shore) less WATER_BELOW_GROUND. Near a lake it eases onto the
 * lake's level over its <Lake riverApproach> from the lake's wall (never below the level on land, never above
 * it in the water), and a river close enough to merge with the lake comes onto it whole. Under a run or a
 * belt it stands RIVER_ROAD_CLEARANCE under the lower of the road's two landings across the whole stretch
 * the road shadows, rising at most RIVER_CAP_GRADE per unit beyond (roads are never moved). A gorge's
 * water runs straight between the two waters it joins, under any cap and never uphill; a climb's falls
 * away from its summit pond (summits.ts); a junction where rivers go on has one value for all of them;
 * the joints within a pond's radius are held at its level (ponds.ts).
 *
 * Every terrain evaluation here runs with the vertex in progress saved and restored (../utils.ts keepingVertex): the
 * network is built mid-vertex in places.
 */

import { smoothstep } from "../../../math";
import { dropOldestHalf } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import { terrainOnlyAt } from "../../vertexCompute";
import { WATER_BELOW_GROUND } from "../constants";
import { keepingVertex, waterGroundAt } from "../utils";
import { riverLakeCloseness } from "../joins";
import type { FieldDisc } from "../types";
import { RIVER_CAP_GRADE, RIVER_LANDING_PAST, RIVER_MEANDER_AMP, RIVER_ROAD_CLEARANCE, riverKeepOff } from "./constants";
import { finalEdge, jointAt, junctionEdges, pieceAt, riverContinuesAt } from "./network";
import { gorgedCodes, junctionGorges } from "./pieceRules";
import { heldRiverPonds, holdPonds, riverPondDiscsOf } from "./ponds";
import { climbJunctionWater, climbSurfaces } from "./summits";
import type { RiverEdge, RiverJunction, RiverPiece } from "./types";

/** A joint's water before any road: its surface, and the lake's signed wall distance and level there
 *  (Infinity / NaN where none is in reach). */
interface JointWater {
  surface: number;
  shore: number;
  level: number;
}
/** Directions a joint looks ACROSS its river for lower ground: an edge's joint its two sides, a junction
 *  (every river meeting there shares its water) six round it. */
const JUNCTION_ACROSS: [number, number][] = Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
/** The water hangs WATER_BELOW_GROUND under the LOWEST ground across its footprint, not under its
 *  centreline: on a hillside the centreline's water stood up to 58u over the downhill bank, which the
 *  channel then raised to its rim — a berm (Evan, Nov 2026: "LOWER the river terrain more so than RAISE
 *  the bank terrain"). The uphill side is cut back by the river's wall instead (../channel carveRiverWall). */
const jointWaterAt = (wx: number, wz: number, factor: number, across: readonly (readonly [number, number])[]): JointWater => {
  const g = waterGroundAt(wx, wz);
  const reach = riverKeepOff() * factor;
  let low = g.h;
  for (const [dx, dz] of across) low = Math.min(low, waterGroundAt(wx + dx * reach, wz + dz * reach).h);
  let surface = low - WATER_BELOW_GROUND;
  const level = g.level;
  if (Number.isNaN(level)) return { surface, shore: Infinity, level };
  const s = g.shore;
  if (s >= 0) {
    surface += (level - surface) * (1 - smoothstep(0, g.approach, s)) * g.fade;
    if (surface < level) surface += (level - surface) * g.lift;
    // Never below the level on land — only on the approach: past it a valley falling away from the lake
    // would hang its river at the level and drop it in one piece (85u at (1652, -1337)).
    if (s < g.approach) surface = Math.max(surface, level);
    surface += (level - surface) * g.fade * riverLakeCloseness(s, factor, domainConfig!.river, true);
  } else surface = level + (Math.min(surface, level) - level) * smoothstep(0, g.approach, -s);
  return { surface, shore: s, level };
};

const junctionWaters = new Map<string, JointWater>();
const junctionWater = (j: RiverJunction): JointWater => {
  let w = junctionWaters.get(j.key);
  if (!w) {
    if (junctionWaters.size > 16384) dropOldestHalf(junctionWaters);
    w = jointWaterAt(j.x, j.z, j.width, JUNCTION_ACROSS);
    junctionWaters.set(j.key, w);
  }
  return w;
};
/** The uncapped surface at a junction: every river meeting there shares it. */
export const junctionBaseSurface = (j: RiverJunction): number => junctionWater(j).surface;

/** Per joint of an edge, its uncapped water (filled lazily). */
const baseWaters = new WeakMap<RiverEdge, (JointWater | undefined)[]>();
const jointWater = (e: RiverEdge, k: number): JointWater => {
  if (k === 0) return junctionWater(e.a);
  if (k === e.count) return junctionWater(e.b);
  let list = baseWaters.get(e);
  if (!list) baseWaters.set(e, (list = []));
  let w = list[k];
  if (!w) {
    const s = (e.len * k) / e.count;
    w = list[k] = jointWaterAt(e.ax + e.ux * s, e.az + e.uz * s, e.a.width + ((e.b.width - e.a.width) * k) / e.count, [
      [-e.uz, e.ux],
      [e.uz, -e.ux],
    ]);
  }
  return w;
};
/** The uncapped surface at joint k of edge e. */
export const baseJointSurface = (e: RiverEdge, k: number): number => jointWater(e, k).surface;

/** Per joint, the lowest a road crossing or shadowing the edge's built river caps its water at. */
const capsOf = (e: RiverEdge): Float64Array => {
  const caps = new Float64Array(e.count + 1).fill(Infinity);
  const paths = e.roads;
  if (!paths) return caps;
  const pieces = finalEdge(e).filter((p): p is RiverPiece => p !== null);
  if (pieces.length === 0) return caps;
  const reach = riverKeepOff();
  const L = e.len / e.count;
  // The edge coordinate a road point shadows while it is inside the footprint (NaN outside).
  const inside = (px: number, pz: number): number => {
    for (const p of pieces) {
      const t = Math.max(0, Math.min(1, ((px - p.sx) * e.ux + (pz - p.sz) * e.uz) / L));
      if (Math.hypot(px - p.sx - e.ux * L * t, pz - p.sz - e.uz * L * t) < reach * (p.w0 + (p.w1 - p.w0) * t) + RIVER_MEANDER_AMP) return Math.max(0, Math.min(e.len, (px - e.ax) * e.ux + (pz - e.az) * e.uz));
    }
    return NaN;
  };
  for (const path of paths) {
    if (path.kind !== "run" && path.kind !== "belt") continue;
    const n = path.wx.length;
    const s = path.wx.map((x, i) => inside(x, path.wz[i]));
    // The road's world point `past` units beyond sample i, walking away from the river by `dir`.
    const landing = (i: number, dir: 1 | -1): number => {
      let left = RIVER_LANDING_PAST;
      let k = i;
      while (k + dir >= 0 && k + dir < n) {
        const l = Math.hypot(path.x[k + dir] - path.x[k], path.z[k + dir] - path.z[k]);
        if (l >= left) {
          const f = left / l;
          return keepingVertex(() => terrainOnlyAt(path.x[k] + (path.x[k + dir] - path.x[k]) * f, path.z[k] + (path.z[k + dir] - path.z[k]) * f, false));
        }
        left -= l;
        k += dir;
      }
      return NaN;
    };
    for (let i0 = 0; i0 < n; ) {
      if (Number.isNaN(s[i0])) {
        i0++;
        continue;
      }
      let i1 = i0;
      while (i1 + 1 < n && !Number.isNaN(s[i1 + 1])) i1++;
      const grades = [i0 > 0 ? landing(i0 - 1, -1) : NaN, i1 < n - 1 ? landing(i1 + 1, 1) : NaN].filter((g) => !Number.isNaN(g));
      if (grades.length > 0) {
        const cap = Math.min(...grades) - RIVER_ROAD_CLEARANCE;
        let s0 = Infinity;
        let s1 = -Infinity;
        for (let i = i0; i <= i1; i++) {
          s0 = Math.min(s0, s[i]);
          s1 = Math.max(s1, s[i]);
        }
        // Held at the ends of every piece the road shadows, rising past them.
        const k0 = Math.floor(s0 / L);
        const k1 = Math.ceil(s1 / L);
        for (let k = 0; k <= e.count; k++) caps[k] = Math.min(caps[k], cap + RIVER_CAP_GRADE * L * Math.max(0, k0 - k, k - k1));
      }
      i0 = i1 + 1;
    }
  }
  return caps;
};

/** An edge's water at every joint: final (C), before any road (U), and the lake's wall distance and
 *  level (for the merge, step 4); and the discs of the ponds it holds, at their levels. */
export interface EdgeSurfaces {
  capped: Float64Array;
  uncapped: Float64Array;
  shore: Float64Array;
  level: Float64Array;
  ponds: FieldDisc[];
}
const surfaces = new WeakMap<RiverEdge, EdgeSurfaces>();
const capCache = new WeakMap<RiverEdge, Float64Array>();
const capsCached = (e: RiverEdge): Float64Array => {
  let c = capCache.get(e);
  if (!c) capCache.set(e, (c = capsOf(e)));
  return c;
};

/** The capped surface every river going on at junction j shares: the lowest of their caps there, and of
 *  the water a climb brings through it. */
const junctionCapped = (j: RiverJunction): number => {
  let v = Math.min(junctionBaseSurface(j), climbJunctionWater(j));
  for (const f of junctionEdges(j)) if (finalEdge(f)[pieceAt(f, j)]) v = Math.min(v, capsCached(f)[jointAt(f, j)]);
  return v;
};

/** The water a gorge reaching junction j meets there: where no river goes on, the line of the
 *  junction's lowest-ridge pair of gorges. */
const gorgeJunctionWater = (j: RiverJunction, capped: boolean): number => {
  const pair = junctionGorges(j).pair;
  if (!pair) return capped ? junctionCapped(j) : junctionBaseSurface(j);
  const at = (e: RiverEdge, k: number) => (capped ? Math.min(baseJointSurface(e, k), capsCached(e)[k]) : baseJointSurface(e, k));
  const [g1, g2] = pair;
  const v1 = at(g1.e, g1.stretch);
  const v2 = at(g2.e, g2.stretch);
  return v1 + ((v2 - v1) * g1.length) / (g1.length + g2.length);
};

/** Past every joint a cap holds down (a road's, a junction's shared value, a gorge's line), the water
 *  rises back at most RIVER_CAP_GRADE per unit along the river: a cap never drops it within one piece.
 *  A junction's shared water (`shared` at either end) is left as it is, and a pond's level is no cap: at
 *  a joint a pond holds (`still`) only the road's own cap there (`caps`) is — the river runs on from a
 *  pond at its own grade (as a cap, a pond's level cut a 40u trench up a dune). A climb's water (`climbing`,
 *  its inner joints) neither seeds nor takes it: no road reaches a climb (summits.ts), and a road's ease
 *  anywhere along the edge, rising 0.12/u, ran up the climb and sank its summit pond 190u. */
const capGrade = (
  s: EdgeSurfaces,
  pieceLength: number,
  shared: [boolean, boolean],
  climbing: ReadonlySet<number>,
  still?: ReadonlySet<number>,
  caps?: Float64Array,
): void => {
  const n = s.capped.length - 1;
  const rise = RIVER_CAP_GRADE * pieceLength;
  const env = new Float64Array(n + 1).fill(Infinity);
  for (let k = 0; k <= n; k++) {
    const seed = still?.has(k) ? caps![k] : s.capped[k];
    if (seed < s.uncapped[k] - 1e-9 && !climbing.has(k)) env[k] = seed;
  }
  for (let k = 1; k <= n; k++) env[k] = Math.min(env[k], env[k - 1] + rise);
  for (let k = n - 1; k >= 0; k--) env[k] = Math.min(env[k], env[k + 1] + rise);
  for (let k = shared[0] ? 1 : 0; k <= (shared[1] ? n - 1 : n); k++) if (!climbing.has(k)) s.capped[k] = Math.min(s.capped[k], env[k]);
};

export const edgeSurfaces = (e: RiverEdge): EdgeSurfaces => {
  const cached = surfaces.get(e);
  if (cached) return cached;
  const n = e.count;
  const caps = capsCached(e);
  const out: EdgeSurfaces = { capped: new Float64Array(n + 1), uncapped: new Float64Array(n + 1), shore: new Float64Array(n + 1), level: new Float64Array(n + 1), ponds: [] };
  for (let k = 0; k <= n; k++) {
    const w = jointWater(e, k);
    out.uncapped[k] = w.surface;
    out.capped[k] = Math.min(w.surface, caps[k]);
    out.shore[k] = w.shore;
    out.level[k] = w.level;
  }
  const climbing = climbSurfaces(e, out.capped, out.uncapped);
  const pieces = finalEdge(e);
  const shared: [boolean, boolean] = [!!pieces[0] && riverContinuesAt(e, e.a), !!pieces[n - 1] && riverContinuesAt(e, e.b)];
  if (shared[0]) out.capped[0] = junctionCapped(e.a);
  if (shared[1]) out.capped[n] = junctionCapped(e.b);
  capGrade(out, e.len / n, shared, climbing);
  gorgedCodes(e);
  const gorges = e.gorges ?? [];
  for (const g of gorges) {
    const ends = (capped: boolean): [number, number] => [
      g.junctionEnd === 0 ? gorgeJunctionWater(e.a, capped) : (capped ? out.capped : out.uncapped)[g.k0],
      g.junctionEnd === 1 ? gorgeJunctionWater(e.b, capped) : (capped ? out.capped : out.uncapped)[g.k1],
    ];
    const [u0, u1] = ends(false);
    const [c0, c1] = ends(true);
    for (let k = g.k0; k <= g.k1; k++) {
      const f = (k - g.k0) / (g.k1 - g.k0);
      out.uncapped[k] = u0 + (u1 - u0) * f;
      out.capped[k] = k === g.k0 ? c0 : k === g.k1 ? c1 : Math.min(c0 + (c1 - c0) * f, caps[k]);
    }
  }
  // The caps' grade, the gorges' straight, never-uphill lines and the ponds' levels, until each holds
  // under the others (all only ever lower the water).
  const ponds = heldRiverPonds(e, out, caps);
  const still = new Set(ponds.flatMap((p) => p.joints));
  holdPonds(ponds, out.capped);
  for (let pass = 0, before = out.capped.slice(); pass < 200; pass++, before = out.capped.slice()) {
    for (const g of gorges) {
      const c0 = out.capped[g.k0];
      const c1 = out.capped[g.k1];
      for (let k = g.k0 + 1; k < g.k1; k++) out.capped[k] = Math.min(out.capped[k], c0 + ((c1 - c0) * (k - g.k0)) / (g.k1 - g.k0));
      // A cap's dip runs on downstream.
      if (c0 >= c1) for (let k = g.k0 + 1; k < g.k1; k++) out.capped[k] = Math.min(out.capped[k], out.capped[k - 1]);
      else for (let k = g.k1 - 1; k > g.k0; k--) out.capped[k] = Math.min(out.capped[k], out.capped[k + 1]);
    }
    capGrade(out, e.len / n, shared, climbing, still, caps);
    holdPonds(ponds, out.capped);
    if (out.capped.every((v, k) => before[k] - v < 1e-9)) break;
  }
  out.ponds = riverPondDiscsOf(e, ponds, out.capped);
  surfaces.set(e, out);
  return out;
};

/** An edge's water at every joint before any road, climb or pond holds it down: the uncapped surfaces with
 *  each gorge's straight line — what the FAR field reads (field.ts farRiverFieldAt), which never builds the
 *  road layer (its freeway routing was most of a far chunk's cost). */
const baseSurfaces = new WeakMap<RiverEdge, Float64Array>();
export const edgeBaseSurfaces = (e: RiverEdge): Float64Array => {
  let out = baseSurfaces.get(e);
  if (out) return out;
  out = new Float64Array(e.count + 1);
  for (let k = 0; k <= e.count; k++) out[k] = baseJointSurface(e, k);
  gorgedCodes(e);
  for (const g of e.gorges ?? []) {
    const u0 = g.junctionEnd === 0 ? gorgeJunctionWater(e.a, false) : out[g.k0];
    const u1 = g.junctionEnd === 1 ? gorgeJunctionWater(e.b, false) : out[g.k1];
    for (let k = g.k0; k <= g.k1; k++) out[k] = u0 + ((u1 - u0) * (k - g.k0)) / (g.k1 - g.k0);
  }
  baseSurfaces.set(e, out);
  return out;
};

export const clearRiverSurfaces = (): void => junctionWaters.clear();
