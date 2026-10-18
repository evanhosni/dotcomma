/**
 * BOULDERS IN EVERY WATERFALL, the odd one in calm water: along each built river piece a seeded
 * scatter of rocks across the water, dense where the surface falls faster than WATERFALL_GRADE (the
 * sheet of water down a rock face, rivers/DECISIONS.md "Steep rivers"), sparse elsewhere, each
 * standing out of the sheet — resting on the carved bed where
 * the bed is shallow enough, lifted to break the surface where it is not (under a near-opaque fall
 * the base is never seen), dropped where that lift would leave it hanging. Bare (no snow), wet (the
 * darker half of the shade range). Each boulder belongs to the chunk holding its centre, so chunked
 * queries never duplicate one. The `rocks` enumerator draws and collides them with the field rocks;
 * the splash enumerator stands white water where the sheet strikes each one, from the same list (no
 * mount parameter reaches this rule: both must agree on every rock). Three-free.
 */

import { seededStream } from "../../math/seededStream";
import { waterBiomeIds } from "../biomeFlags";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { type RockPoint, rockFootprint, rockLookAt, rockPointOf, rockRestingY } from "../rocks/rockPlacement";
import { drawnGroundAt } from "../underground/drawnGround";
import { computeVertexData } from "../vertexCompute";
import { riverMaxReach } from "./constants";
import { riverPiecesIn } from "./riverNetwork";
import { riverPieceEndSurface } from "./riverSurface";
import type { RiverPiece } from "./types";

/** Surface drop per unit along a piece from which it is a waterfall (0.25 = a 14° fall; the river
 *  splashes' mount uses the same for its feet). */
export const WATERFALL_GRADE = 0.25;
/** One rock attempt per this much square water on average in a fall, and in calm water (most attempts
 *  are dropped under deep water; a calm piece's hover allowance is small, so its few rocks stand at the
 *  shallow edges, and a burst needs a fall's grade, so they carry no spray). */
const ROCK_SPACING = 14;
const CALM_ROCK_SPACING = 32;
/** Rocks reach this share of the half-width either side of the centreline. */
const ROCK_ACROSS = 0.95;
const SIZE_MIN = 1.2;
const SIZE_MAX = 7;
/** A rock's top stands at least this share of its half height, and this far, over the water surface at
 *  its centre (at 0.4u only its tip broke the sheet: a field of blue lumps under the water). */
const PROTRUDE_SHARE = 0.7;
const PROTRUDE_MIN = 0.6;
/** The most a lifted rock's base may hang over the ground under its CENTRE (on a steep face the
 *  footprint's lowest ground lies a rock height down the slope), plus this much per unit of grade:
 *  the steeper the fall, the whiter and more opaque its sheet, and the less of a base is ever seen
 *  (at a flat 1.5u the 40°+ mountain falls kept 4–9 boulders per 512u square, the rapids 25–45). */
const HOVER_MAX = 1.5;
const HOVER_PER_GRADE = 8;
/** A wet rock's shade is the darker half of the range. */
const WET_SHADE = 0.5;

export interface WaterfallBoulder {
  rock: RockPoint;
  /** Unit direction downhill along the fall (world). */
  dirX: number;
  dirZ: number;
  /** The fall's surface drop per unit of length. */
  grade: number;
}

/** The surface drop per unit of length along a piece. */
export const riverPieceGrade = (p: RiverPiece): number => {
  const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
  if (len < 1e-6) return 0;
  return Math.abs(riverPieceEndSurface(p, 1) - riverPieceEndSurface(p, 0)) / len;
};

/** Every waterfall boulder whose centre lies in the box, with its fall's direction and steepness. */
export const getWaterfallBoulders = (minX: number, minZ: number, maxX: number, maxZ: number): WaterfallBoulder[] => {
  const out: WaterfallBoulder[] = [];
  const config = domainConfig;
  if (!config) return out;
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const halfWidth = config.river.halfWidth;
  const lakes = waterBiomeIds();
  for (const p of riverPiecesIn(center, minX, minZ, maxX, maxZ, riverMaxReach())) {
    const grade = riverPieceGrade(p);
    const spacing = grade > WATERFALL_GRADE ? ROCK_SPACING : CALM_ROCK_SPACING;
    const dx = p.ex - p.sx;
    const dz = p.ez - p.sz;
    const len = Math.hypot(dx, dz);
    const ax = dx / len;
    const az = dz / len;
    const downSign = riverPieceEndSurface(p, 1) < riverPieceEndSurface(p, 0) ? 1 : -1;
    const midReach = (ROCK_ACROSS * halfWidth * (p.w0 + p.w1)) / 2;
    const attempts = Math.round((len * 2 * midReach) / (spacing * spacing));
    // The rolls are per piece: the same rocks from every chunk that asks.
    const roll = seededStream(`${config.seed}|fallrocks|${p.edge.key}|${p.index}`);
    for (let i = 0; i < attempts; i++) {
      const t = roll.next();
      const reach = ROCK_ACROSS * halfWidth * (p.w0 + (p.w1 - p.w0) * t);
      const across = (roll.next() * 2 - 1) * reach;
      const u = roll.next();
      const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * u * u;
      const wx = p.sx + ax * len * t - az * across;
      const wz = p.sz + az * len * t + ax * across;
      const world = unwarp(wx, wz);
      if (world.x < minX || world.x >= maxX || world.z < minZ || world.z >= maxZ) continue;
      const vd = computeVertexData(world.x, world.z);
      if (!(vd.waterDepth > 0) || vd.underDeck > 0 || lakes.includes(vd.biomeId)) continue;
      const water = vd.waterHeight;
      const look = rockLookAt(world.x, world.z, size);
      let lowest = Infinity;
      for (const [px, pz] of rockFootprint(world.x, world.z, look)) lowest = Math.min(lowest, drawnGroundAt(px, pz));
      const y = Math.max(rockRestingY(lowest, look), water + Math.max(PROTRUDE_MIN, PROTRUDE_SHARE * look.sy) - look.sy);
      if (y - look.sy - drawnGroundAt(world.x, world.z) > HOVER_MAX + HOVER_PER_GRADE * grade) continue;
      // The downhill direction in world space: a short step down the (warped) piece, unwarped.
      const ahead = unwarp(wx + ax * downSign * 4, wz + az * downSign * 4);
      const l = Math.hypot(ahead.x - world.x, ahead.z - world.z) || 1;
      const rock = rockPointOf(world.x, y, world.z, { ...look, shade: look.shade * WET_SHADE }, lowest, 0);
      out.push({ rock, dirX: (ahead.x - world.x) / l, dirZ: (ahead.z - world.z) / l, grade });
    }
  }
  return out;
};

/** The boulders as rocks: what the `rocks` enumerator draws and collides. */
export const getWaterfallRocks = (minX: number, minZ: number, maxX: number, maxZ: number): RockPoint[] =>
  getWaterfallBoulders(minX, minZ, maxX, maxZ).map((b) => b.rock);
