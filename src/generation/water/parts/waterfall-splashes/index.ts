import { seededStream } from "../../../../utils/math";
import { domainConfig } from "../../../store";
import { unwarp, warpMax } from "../../../utils";
import { computeVertexData } from "../../..";
import { zoneAtWarped } from "../../../zones";
import { fallGrade } from "../../params";
import { getWaterfallBoulders } from "../waterfall-boulders";
import { edgeSurfaces, finalEdge, riverMaxReach, riverPiecesNear, riversExist } from "../../rivers";
import type { RiverEdge, RiverPiece } from "../../rivers";
import { isLakeBiome } from "../../lakes/params";
import type { SplashEmitterParams, SplashEmitter } from "./types";

/**
 * WHITE WATER emitters (objects/particles/waterfall-splashes; generation/water/DECISIONS.md "Spray over the water",
 * "The spray stands on its own water"): a seeded scatter over the plunge pool at the FOOT of every fall
 * — the bottom piece of a run of pieces steeper than the <Water> base's fall grade, never where the foot
 * stands in a lake biome (a river dropping onto a lake's level has no fall) — thickest midway along and
 * across, each emitter on its own water; and one BURST where a fall's sheet strikes each boulder standing
 * in it (none where <WaterfallBoulders/> is not mounted). Each emitter belongs to the chunk holding its
 * position. Three-free.
 */

/** The pool's patch runs from POOL_BEFORE upstream of the foot to POOL_AFTER past it. */
const POOL_BEFORE = 6;
const POOL_AFTER = 32;
/** The pool reaches the water's edge. */
const ACROSS_SHARE = 1;
/** Each emitter keeps a share of its fall's strength rolled from STRENGTH_MIN to 1, and scales its
 *  count over COUNT_RANGE: no two alike. */
const STRENGTH_MIN = 0.35;
const COUNT_RANGE: [number, number] = [0.5, 1.6];
/** A pool emitter stands OVER_WATER plus up to LIFT_MAX (its own roll) over its water. */
const OVER_WATER = 0.1;
const LIFT_MAX = 1.2;
/** A burst stands this share of its boulder's mean half-width upstream of its centre, BURST_LIFT over
 *  the water line on that face; its count runs over COUNT_RANGE with the rock's widest half-size, from
 *  BURST_SIZE_FROM to BURST_SIZE_SPAN past it. */
const BURST_UPSTREAM = 0.75;
const BURST_LIFT = 0.3;
const BURST_SIZE_FROM = 1;
const BURST_SIZE_SPAN = 6;

const strengthOf = (grade: number, minGrade: number): number => Math.min(1, 0.3 + (0.7 * (grade - minGrade)) / (2 * minGrade));
const ownStrength = (strength: number, roll: number): number => strength * (STRENGTH_MIN + (1 - STRENGTH_MIN) * roll);
const countOf = (count: number, share: number): number => Math.round(count * (COUNT_RANGE[0] + (COUNT_RANGE[1] - COUNT_RANGE[0]) * share));
/** A triangular roll in [a, b]: thickest in the middle. */
const tri = (r1: number, r2: number, a: number, b: number): number => a + ((b - a) * (r1 + r2)) / 2;

export const getRiverSplashEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: SplashEmitterParams): SplashEmitter[] => {
  if (!domainConfig || !riversExist()) return [];
  const minGrade = fallGrade();
  const hw = domainConfig.river.halfWidth;
  const out: SplashEmitter[] = [];
  const pieces = riverPiecesNear(minX, minZ, maxX, maxZ, warpMax() + riverMaxReach() + POOL_AFTER);
  // Whole edges: a fall's foot must not depend on which of its pieces reach the box.
  const edges = new Map<string, RiverEdge>();
  for (const p of pieces) edges.set(p.edge.key, p.edge);
  for (const e of edges.values()) {
    const list = finalEdge(e);
    const s = edgeSurfaces(e).capped;
    const L = e.len / e.count;
    const steep = (p: RiverPiece | null): p is RiverPiece => p !== null && Math.abs(s[p.index] - s[p.index + 1]) / L > minGrade;
    for (let k = 0; k < list.length; ) {
      if (!steep(list[k])) {
        k++;
        continue;
      }
      let m = k;
      while (m + 1 < list.length && steep(list[m + 1])) m++;
      // The foot: the lower end of the run.
      const downstream = s[k] >= s[m + 1];
      const bottom = (downstream ? list[m] : list[k])!;
      const footJoint = downstream ? bottom.index + 1 : bottom.index;
      k = m + 1;
      const fx = e.ax + e.ux * footJoint * L;
      const fz = e.az + e.uz * footJoint * L;
      if (isLakeBiome(zoneAtWarped(fx, fz).biome)) continue;
      const grade = Math.abs(s[bottom.index] - s[bottom.index + 1]) / L;
      const ux = downstream ? e.ux : -e.ux;
      const uz = downstream ? e.uz : -e.uz;
      const a = unwarp(fx, fz);
      const b = unwarp(fx + ux * 10, fz + uz * 10);
      const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const half = hw * (downstream ? bottom.w1 : bottom.w0) * ACROSS_SHARE;
      const stream = seededStream(`${domainConfig.seed} - splash ${e.key}:${footJoint}`);
      const n = Math.round(((POOL_BEFORE + POOL_AFTER) * 2 * half) / (2 * params.spacing * params.spacing));
      for (let i = 0; i < n; i++) {
        const along = tri(stream.next(), stream.next(), -POOL_BEFORE, POOL_AFTER);
        const across = tri(stream.next(), stream.next(), -half, half);
        const lift = OVER_WATER + stream.next() * LIFT_MAX;
        const strength = ownStrength(strengthOf(grade, minGrade), stream.next());
        const count = countOf(params.count, stream.next());
        const w = unwarp(fx + ux * along - uz * across, fz + uz * along + ux * across);
        if (w.x < minX || w.x >= maxX || w.z < minZ || w.z >= maxZ) continue;
        const vd = computeVertexData(w.x, w.z);
        if (!(vd.waterHeight > vd.height)) continue;
        out.push({ x: w.x, y: vd.waterHeight + lift, z: w.z, dirX: (b.x - a.x) / dl, dirZ: (b.z - a.z) / dl, strength, count, burst: 0 });
      }
    }
  }
  for (const boulder of getWaterfallBoulders(minX, minZ, maxX, maxZ)) {
    if (boulder.grade <= minGrade) continue;
    const r = boulder.rock;
    const back = (BURST_UPSTREAM * (r.sx + r.sz)) / 2;
    const x = r.x - boulder.dirX * back;
    const z = r.z - boulder.dirZ * back;
    const vd = computeVertexData(x, z);
    if (!(vd.waterHeight > vd.height)) continue;
    const roll = seededStream(`${domainConfig.seed} - strike ${r.x},${r.z}`).next();
    const size = Math.min(1, Math.max(0, (Math.max(r.sx, r.sz) - BURST_SIZE_FROM) / BURST_SIZE_SPAN));
    // The water line on the face: the sheet where it meets the rock, or the rock's top where it runs over.
    const y = Math.min(vd.waterHeight, r.y + r.sy) + BURST_LIFT;
    out.push({ x, y, z, dirX: boulder.dirX, dirZ: boulder.dirZ, strength: ownStrength(strengthOf(boulder.grade, minGrade), roll), count: countOf(params.count, size), burst: 1 });
  }
  return out;
};
