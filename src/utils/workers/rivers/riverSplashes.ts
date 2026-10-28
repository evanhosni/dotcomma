/**
 * SPLASH EMITTERS at the foot of every steep river drop: where a built piece's surface falls faster
 * than `minGrade` between its two ends (riverSurface.ts), a patch of emitters stands in the plunge
 * pool — from a little above the foot to SPLASH_PAST_FOOT downstream, across the WHOLE water — each
 * jittered off a `spacing` lattice by a seeded roll (and some lattice cells left empty), so the spray
 * reads as scattered, not gridded. Each emitter carries the downhill direction and the drop's
 * strength, and belongs to the chunk holding its world position, so chunked queries never duplicate
 * one. Where the sheet of a fall STRIKES a boulder standing in it (waterfallRocks.ts), one more
 * emitter stands at the rock's upstream water line, a BURST (up and sideways more than downstream).
 * Three-free; the particles themselves are src/particles (the dressing member
 * objects/dressing/particles/RiverSplashes.tsx).
 */

import { seededStream } from "../../math/seededStream";
import { waterBiomeIds } from "../lakes";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { computeVertexData } from "../vertexCompute";
import { riverMaxReach } from "./constants";
import { riverEdgePiece, riverPiecesIn } from "./riverNetwork";
import { riverPieceEndSurface } from "./riverSurface";
import { getWaterfallBoulders } from "./waterfallRocks";

export interface SplashEmitterParams {
  /** Surface drop per unit along the piece from which the water splashes (0.25 = a 14° fall). */
  minGrade: number;
  /** The emitter lattice's cell, real units (each emitter is jittered within its cell). */
  spacing: number;
  /** Particles per emitter. */
  count: number;
}

export interface SplashEmitter {
  x: number;
  /** Just over the water surface there. */
  y: number;
  z: number;
  count: number;
  /** 0–1 with the drop's steepness: how high and how far the particles fly. */
  strength: number;
  /** Unit direction downhill along the river (world). */
  dirX: number;
  dirZ: number;
  /** 1 where the sheet strikes a boulder (a burst: up and sideways), 0 in a plunge pool. */
  burst: number;
}

/** The patch runs from this far before the foot (up the fall) to this far past it, downstream; its
 *  emitter COUNT is that of a patch SPLASH_SPREAD times shorter (the spread thins it, not thickens). */
const SPLASH_BEFORE_FOOT = 6;
const SPLASH_PAST_FOOT = 32;
const SPLASH_SPREAD = 2;
/** Emitters cover this share of the half-width either side of the centerline: the water's edge. */
const SPLASH_ACROSS = 1.0;
/** The least share of the drop's strength an emitter keeps, and the range an emitter's particle count
 *  is scaled over (each rolls its own): no two alike. */
const SPLASH_STRENGTH_MIN = 0.35;
const SPLASH_COUNT_RANGE: [number, number] = [0.5, 1.6];
const SPLASH_OVER_SURFACE = 0.1;
/** Each emitter also stands up to this much higher, by its own roll. */
const SPLASH_LIFT_SPREAD = 1.2;
/** The strength reaches 1 this much grade past minGrade. */
const STRENGTH_GRADE_SPAN = 0.5;
/** A boulder's emitter stands this share of its mean half-width upstream of its centre (its upstream
 *  face), this far over the water line there. */
const STRIKE_FACE_SHARE = 0.75;
const STRIKE_LIFT = 0.3;
/** A boulder's count runs over SPLASH_COUNT_RANGE with its widest half-size, from this size to this far past it. */
const STRIKE_SIZE_FROM = 1;
const STRIKE_SIZE_SPAN = 6;

/** The strength of a drop of `grade`: 0 at minGrade, 1 STRENGTH_GRADE_SPAN past it. */
const strengthOfGrade = (grade: number, params: SplashEmitterParams): number => Math.min(1, (grade - params.minGrade) / STRENGTH_GRADE_SPAN);

/** One emitter per boulder of the box, at its upstream water line, the fall's steepness for strength,
 *  the rock's size for count. The rock's chunk owns the emitter even when its face crosses the border;
 *  a boulder whose upstream face stands dry (at the water's edge) has none. */
const boulderStrikeEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: SplashEmitterParams, out: SplashEmitter[]): void => {
  for (const b of getWaterfallBoulders(minX, minZ, maxX, maxZ)) {
    const grade = strengthOfGrade(b.grade, params);
    if (!(grade > 0)) continue;
    const r = b.rock;
    const face = (STRIKE_FACE_SHARE * (r.sx + r.sz)) / 2;
    const x = r.x - b.dirX * face;
    const z = r.z - b.dirZ * face;
    const strike = computeVertexData(x, z);
    if (!(strike.waterDepth > 0)) continue;
    const roll = seededStream(`${domainConfig!.seed}|strike|${r.x},${r.z}`);
    const strength = grade * (SPLASH_STRENGTH_MIN + (1 - SPLASH_STRENGTH_MIN) * roll.next());
    const sizeShare = Math.min(1, Math.max(0, (Math.max(r.sx, r.sz) - STRIKE_SIZE_FROM) / STRIKE_SIZE_SPAN));
    const count = Math.round(params.count * (SPLASH_COUNT_RANGE[0] + (SPLASH_COUNT_RANGE[1] - SPLASH_COUNT_RANGE[0]) * sizeShare));
    // The water line on the face: the sheet where it meets the rock, or the rock's top when the sheet runs over it.
    const y = Math.min(strike.waterHeight, r.y + r.sy) + STRIKE_LIFT;
    out.push({ x, y, z, count, strength, dirX: b.dirX, dirZ: b.dirZ, burst: 1 });
  }
};

export const getRiverSplashEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: SplashEmitterParams): SplashEmitter[] => {
  const out: SplashEmitter[] = [];
  if (!domainConfig) return out;
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const halfWidth = domainConfig.river.halfWidth;
  for (const p of riverPiecesIn(center, minX, minZ, maxX, maxZ, riverMaxReach())) {
    const dx = p.ex - p.sx;
    const dz = p.ez - p.sz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const h0 = riverPieceEndSurface(p, 0);
    const h1 = riverPieceEndSurface(p, 1);
    const grade = Math.abs(h1 - h0) / len;
    if (!(grade > params.minGrade)) continue;
    const lowAtEnd = h1 < h0;
    // Only the BOTTOM of a fall: a steep piece whose downstream neighbour runs on steeply is the
    // fall's middle, with no foot of its own (a long fall showed a foot at every 50u piece).
    const next = riverEdgePiece(p.edge, lowAtEnd ? p.index + 1 : p.index - 1);
    if (next) {
      const nl = Math.hypot(next.ex - next.sx, next.ez - next.sz) || 1;
      const ng = Math.abs(riverPieceEndSurface(next, 1) - riverPieceEndSurface(next, 0)) / nl;
      if (ng > params.minGrade) continue;
    }
    const footX = lowAtEnd ? p.ex : p.sx;
    const footZ = lowAtEnd ? p.ez : p.sz;
    const surface = Math.min(h0, h1);
    const factor = lowAtEnd ? p.w1 : p.w0;
    const downX = (lowAtEnd ? dx : -dx) / len;
    const downZ = (lowAtEnd ? dz : -dz) / len;
    const perpX = -downZ;
    const perpZ = downX;
    // No foot where the river runs INTO a lake: its surface drops onto the lake's level there, a
    // grade with no fall (white water lay on the still lake at every mouth, Evan's screenshot).
    const footWorld = unwarp(footX, footZ);
    if (waterBiomeIds().includes(computeVertexData(footWorld.x, footWorld.z).biomeId)) continue;
    const strength = strengthOfGrade(grade, params);
    const reach = SPLASH_ACROSS * halfWidth * factor;
    const length = SPLASH_BEFORE_FOOT + SPLASH_PAST_FOOT;
    // A random SCATTER over the plunge pool, one emitter per spacing² on average over the unspread
    // patch, thickest at its middle both along and across (the sum of two rolls: a triangle) and
    // thinning to its edges, each with its own strength and count — a lattice with jitter still read
    // as a strip of even spray.
    const emitterCount = Math.round((length * 2 * reach) / (params.spacing * params.spacing * SPLASH_SPREAD));
    // The rolls are per piece: the same emitters from every chunk that asks.
    const roll = seededStream(`${domainConfig.seed}|splash|${p.edge.key}|${p.index}`);
    for (let e = 0; e < emitterCount; e++) {
      const along = -SPLASH_BEFORE_FOOT + length * ((roll.next() + roll.next()) / 2);
      const across = (roll.next() + roll.next() - 1) * reach;
      const own = strength * (SPLASH_STRENGTH_MIN + (1 - SPLASH_STRENGTH_MIN) * roll.next());
      const count = Math.round(params.count * (SPLASH_COUNT_RANGE[0] + (SPLASH_COUNT_RANGE[1] - SPLASH_COUNT_RANGE[0]) * roll.next()));
      const wx = footX + downX * along + perpX * across;
      const wz = footZ + downZ * along + perpZ * across;
      const world = unwarp(wx, wz);
      if (world.x < minX || world.x >= maxX || world.z < minZ || world.z >= maxZ) continue;
      const ahead = unwarp(wx + downX * 4, wz + downZ * 4);
      const l = Math.hypot(ahead.x - world.x, ahead.z - world.z) || 1;
      // On the water where IT stands (the pool keeps falling downstream of the foot) — one plane of
      // spray read as a shelf — lifted by its own roll.
      const here = computeVertexData(world.x, world.z);
      const waterY = here.waterDepth > 0 ? here.waterHeight : surface;
      out.push({
        x: world.x,
        y: waterY + SPLASH_OVER_SURFACE + roll.next() * SPLASH_LIFT_SPREAD,
        z: world.z,
        count,
        strength: own,
        dirX: (ahead.x - world.x) / l,
        dirZ: (ahead.z - world.z) / l,
        burst: 0,
      });
    }
  }
  boulderStrikeEmitters(minX, minZ, maxX, maxZ, params, out);
  return out;
};
