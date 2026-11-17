import { seededStream } from "../../../../utils/math";
import { biomeById } from "../../../registry";
import { domainConfig } from "../../../store";
import { unwarp, warpMax } from "../../../utils";
import type { RockPoint } from "../../../rocks/types";
import { rockFootprint, rockLookAt, rockPointOf, rockRestingY } from "../../../rocks";
import { drawnGroundAt } from "../../../drawn-ground";
import { computeVertexData } from "../../..";
import { fallGrade, waterBasePart } from "../../params";
import { edgeSurfaces, riverMaxReach, riverPiecesNear, riversExist } from "../../rivers";
import { isLakeBiome } from "../../lakes/params";
import type { WaterfallBoulder } from "./types";
import type { WaterfallBouldersParams } from "./params";
import { WATERFALL_BOULDERS } from "./params";

/**
 * BOULDERS in the rivers (generation/water/DECISIONS.md "Boulders in every waterfall", "Fewer boulders in a fall"),
 * a part of the <Water> base (<WaterfallBoulders/>: none where it is not mounted): along every built piece
 * a seeded scatter of rocks across 95% of its half-width — one per `spacing`² where the surface falls
 * faster than the base's fall grade, one per `calmSpacing`² in calm water — kept where the water is wet,
 * off decks and out of lake biomes. Sizes skew small. Each rock rests on the lowest drawn ground under its
 * footprint with its top over the water, and a rock whose base would hang too far over the ground is
 * dropped (the steeper the fall, the whiter the sheet, the less of a base is ever seen). Bare and
 * wet-darkened, on the rock dressing's look (generation/rocks/index.ts), so they draw and collide as rocks.
 * ONE list feeds the `waterfallBoulders` and `waterfallSplashes` enumerators. Three-free.
 */

const ACROSS_SHARE = 0.95;
/** Sizes skew small: SIZE_MIN + (SIZE_MAX − SIZE_MIN)·u² for a uniform u. */
const SIZE_MIN = 1.2;
const SIZE_MAX = 7;
/** A rock's top stands at least max(TOP_MIN, TOP_SHARE × its half height) over the water. */
const TOP_MIN = 0.6;
const TOP_SHARE = 0.7;
/** Its base may hang at most HOVER + HOVER_PER_GRADE × grade over the ground under its CENTRE (it rests
 *  on its footprint's lowest ground, which on a steep face lies a rock height down the slope). */
const HOVER = 1.5;
const HOVER_PER_GRADE = 8;

/** Every river boulder whose centre lies in a world box. */
export const getWaterfallBoulders = (minX: number, minZ: number, maxX: number, maxZ: number): WaterfallBoulder[] => {
  const mount = domainConfig ? waterBasePart<WaterfallBouldersParams>(WATERFALL_BOULDERS) : null;
  if (!mount || !riversExist()) return [];
  const falls = fallGrade();
  const hw = domainConfig!.river.halfWidth;
  const out: WaterfallBoulder[] = [];
  for (const p of riverPiecesNear(minX, minZ, maxX, maxZ, warpMax() + riverMaxReach())) {
    const e = p.edge;
    const s = edgeSurfaces(e).capped;
    const L = e.len / e.count;
    const drop = s[p.index] - s[p.index + 1];
    const grade = Math.abs(drop) / L;
    const sign = drop < 0 ? -1 : 1;
    const a = unwarp(p.sx, p.sz);
    const b = unwarp(p.ex, p.ez);
    const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const spacing = grade > falls ? mount.spacing : mount.calmSpacing;
    const stream = seededStream(`${domainConfig!.seed} - fallrocks ${e.key}:${p.index}`);
    const expected = (L * 2 * ACROSS_SHARE * hw * (p.w0 + p.w1)) / 2 / (spacing * spacing);
    const count = Math.floor(expected) + (stream.next() < expected - Math.floor(expected) ? 1 : 0);
    for (let c = 0; c < count; c++) {
      const t = stream.next();
      const across = stream.between(-ACROSS_SHARE, ACROSS_SHARE) * hw * (p.w0 + (p.w1 - p.w0) * t);
      const u = stream.next();
      const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * u * u;
      const w = unwarp(p.sx + (p.ex - p.sx) * t - e.uz * across, p.sz + (p.ez - p.sz) * t + e.ux * across);
      if (w.x < minX || w.x >= maxX || w.z < minZ || w.z >= maxZ) continue;
      const vd = computeVertexData(w.x, w.z);
      if (vd.underDeck > 0 || !(vd.waterHeight > vd.height)) continue;
      if (isLakeBiome(biomeById(vd.biomeId) ?? {})) continue;
      const look = rockLookAt(w.x, w.z, size);
      look.shade *= 0.5;
      let lowest = Infinity;
      for (const [fx, fz] of rockFootprint(w.x, w.z, look)) lowest = Math.min(lowest, drawnGroundAt(fx, fz));
      const y = Math.max(rockRestingY(lowest, look), vd.waterHeight + Math.max(TOP_MIN, TOP_SHARE * look.sy) - look.sy);
      if (y - look.sy - drawnGroundAt(w.x, w.z) > HOVER + HOVER_PER_GRADE * grade) continue;
      out.push({ rock: rockPointOf(w.x, y, w.z, look, lowest, 0), grade, dirX: ((b.x - a.x) / dl) * sign, dirZ: ((b.z - a.z) / dl) * sign });
    }
  }
  return out;
};

export const getWaterfallRocks = (minX: number, minZ: number, maxX: number, maxZ: number): RockPoint[] => getWaterfallBoulders(minX, minZ, maxX, maxZ).map((b) => b.rock);
