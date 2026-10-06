/**
 * The WATERFRONT (CLAUDE.md "City terrain"): where a city wall lies in a river's footprint, the belt
 * freeway is carried along the water's straight edge instead, one road with the belt.
 */

import { smoothstep } from "../../math/_math";
import { domainConfig } from "../computeConfig";
import { riverListKey, riverListNearSegment, riverStraight, riverStraightNear } from "../rivers/riverField";
import type { RiverQuaySample, Wall } from "../types";
import { isCanonicalWall } from "../voronoi";
import { smoothMin } from "./freewayNetwork";

/** A belt wall counts as DROWNED (the river's footprint reaches over it) across this window centered
 *  where its river-side curb is just dry (bank + freewayWidth), fading in over it (real units). Over 30u
 *  past that line, where a wall leaves the river at an angle its share rose 0.17 in 5u, and the belt's
 *  push past CITY_WATERFRONT_BELT_HOLD tore its outer edge into spikes of curb and sand (screenshot 97);
 *  over 60u past it, dry walls beside a river mouth gave their belt way to a block's tip (103). */
const CITY_WATERFRONT_FADE = 60;
/** How far from a road's centerline its distance still matters to the city (real units): the
 *  belt's field has recovered well past the block band, and its paint and grade are long gone. */
const CITY_WATERFRONT_READ = 80;
/** A wall is drowned only as far as it runs along the river: |cos| of the angle between them. */
const CITY_WATERFRONT_ALIGN_LO = Math.cos((50 * Math.PI) / 180);
const CITY_WATERFRONT_ALIGN_HI = Math.cos((30 * Math.PI) / 180);
/** A drowned wall's belt is pushed this far off (and the waterfront, where no wall is drowned), so the
 *  two hand the road over continuously: min() of the two, rounded by CITY_WATERFRONT_FILLET. The
 *  push grows over CITY_WATERFRONT_FADE — a steeper one aliases into a staircase curb. */
const CITY_WATERFRONT_PENALTY = 45;
/** Where the river drowns a wall partly (its share 0 → 1), the belt stays on it up to
 *  CITY_WATERFRONT_BELT_HOLD, while the waterfront line's push eases off by smoothstep of the share, so
 *  the two overlap there and one road runs on from the other. Pushed away together, linearly (the belt
 *  by the share, the line by the rest), both were ~22u off midway: the belt ended in a stub on the sand
 *  and the waterfront began apart from it, a sidewalk tongue between them (screenshot). With the line
 *  fully in play from a share of 0.4 on instead, a second branch of it ran beside the first where the
 *  river's quay field folds, and the ridge between drew as a row of curb teeth. */
const CITY_WATERFRONT_BELT_HOLD = 0.6;
/** The smooth minimum's reach where the belt turns onto the waterfront: a rounded corner. */
const CITY_WATERFRONT_FILLET = 30;
/** Off the city the waterfront line is pushed away by this many units per unit outside the wall: on
 *  the wall it is the city's, so the two halves meet, and it never runs on into the neighbor. */
const CITY_WATERFRONT_OUTSIDE_PUSH = 3;
/** The waterfront line comes into play as a drowned wall's share (wf) grows past CITY_WATERFRONT_ONSET:
 *  below it the line is pushed up to CITY_WATERFRONT_ABSENT off, past any belt distance (real units). */
const CITY_WATERFRONT_ONSET = 0.1;
const CITY_WATERFRONT_ABSENT = 1e4;

/** How far a (warped) point of a city wall is DROWNED, 0–1: the river's footprint reaches its belt's
 *  river-side curb. From the current vertex's river piece list (riverStraightNear). */
export const wallDrownedAt = (px: number, pz: number, wallDx = NaN, wallDz = NaN): number => {
  riverStraightNear(px, pz);
  if (!(riverStraight.distance < Infinity)) return 0;
  const rv = domainConfig!.river;
  const edge = (rv.halfWidth + rv.bank) * riverStraight.factor + domainConfig!.cityConfig.freewayWidth;
  const drowned = 1 - smoothstep(edge - CITY_WATERFRONT_FADE / 2, edge + CITY_WATERFRONT_FADE / 2, riverStraight.distance);
  if (Number.isNaN(wallDx)) return drowned;
  // Only a wall running ALONG the river: a belt crossing it is decked, not drowned (its closest
  // point to a vertex beside the crossing lies in the channel).
  const l = Math.hypot(wallDx, wallDz) || 1;
  return drowned * smoothstep(CITY_WATERFRONT_ALIGN_LO, CITY_WATERFRONT_ALIGN_HI, Math.abs(wallDx * riverStraight.dirX + wallDz * riverStraight.dirZ) / l);
};

/** wallDrownedAt along a wall, sampled at WALL_DROWNED_SAMPLES points per wall and river list and
 *  interpolated (asked per vertex for every wall beside a river it cost ~15 ms per LOD1 chunk). */
const WALL_DROWNED_SAMPLES = 17;
const wallDrownedCache = new WeakMap<Wall, { list: unknown; v: Float64Array }>();
const wallDrownedAlong = (w: Wall, t: number): number => {
  const list = riverListKey();
  let hit = wallDrownedCache.get(w);
  if (!hit || hit.list !== list) {
    const v = new Float64Array(WALL_DROWNED_SAMPLES);
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    for (let k = 0; k < WALL_DROWNED_SAMPLES; k++) {
      const u = k / (WALL_DROWNED_SAMPLES - 1);
      v[k] = wallDrownedAt(w.sx + dx * u, w.sz + dz * u, dx, dz);
    }
    hit = { list, v };
    wallDrownedCache.set(w, hit);
  }
  const f = t * (WALL_DROWNED_SAMPLES - 1);
  const k = Math.min(WALL_DROWNED_SAMPLES - 2, Math.floor(f));
  return hit.v[k] + (hit.v[k + 1] - hit.v[k]) * (f - k);
};

/** The WATERFRONT: the city's belt freeway continues along the river instead of stopping at the water.
 *  Where a city wall lies in a river's footprint, the belt runs along the water's straight edge
 *  instead, its river-side curb on the bank (bank + freewayWidth from the centerline), and rejoins the
 *  belt where the wall comes out of the water — one road, one set of lanes. Off the city (`inCity`
 *  false) the waterfront line is pushed off with the distance from the wall (CITY_WATERFRONT_OUTSIDE_PUSH). Writes waterfrontBelt: `distance`, the real distance to
 *  that road's centerline (the belt's own where no wall is drowned); `waterfront`, how far a drowned
 *  wall is in play (0–1); `onWaterfront`, whether the waterfront line is the nearer part. The vertex's
 *  own river piece list must be current (riverQuayAt ran for it). */
export const waterfrontBelt = { distance: Infinity, waterfront: 0, onWaterfront: false };
export const findWaterfrontBelt = (wx: number, wz: number, walls: Wall[], beltDistance: number, quay: RiverQuaySample, inCity: boolean): void => {
  waterfrontBelt.distance = beltDistance;
  waterfrontBelt.waterfront = 0;
  waterfrontBelt.onWaterfront = false;
  if (!(quay.distance < Infinity) || walls.length === 0) return;
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const fw = domainConfig!.cityConfig.freewayWidth;
  // Far from every wall and from where a waterfront could run, nothing here reads the belt's
  // distance any more (its field has recovered, no paint or grade reaches this far).
  if (beltDistance > CITY_WATERFRONT_READ && Math.abs(quay.distance - (reach * quay.factor + fw)) > CITY_WATERFRONT_READ) return;
  let dry = Infinity;
  let wf = 0;
  // Past this a wall changes nothing: the nearest wall alone keeps the belt within beltDistance + the
  // penalty. A drowned wall's waterfront fades out over CITY_WATERFRONT_FADE before it (cut off there, the
  // waterfront switched on at once: 1.9u of plateau at (-954, 1034)).
  const farthest = beltDistance + CITY_WATERFRONT_PENALTY;
  const bank = reach * quay.factor;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    // Each wall is listed twice, endpoint-swapped.
    if (!isCanonicalWall(w)) continue;
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((wx - w.sx) * dx + (wz - w.sz) * dz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = w.sx + dx * t;
    const pz = w.sz + dz * t;
    const dist = Math.hypot(wx - px, wz - pz);
    if (dist > farthest) continue;
    // A wall nowhere near the river is never drowned (the common case: a quick test per wall).
    if (!riverListNearSegment(w, w.sx, w.sz, w.ex, w.ez, reach, fw + CITY_WATERFRONT_FADE)) {
      dry = Math.min(dry, dist);
      continue;
    }
    const drowned = wallDrownedAlong(w, t);
    if (drowned <= 0) {
      dry = Math.min(dry, dist);
      continue;
    }
    const near = (1 - smoothstep(quay.distance + bank, quay.distance + bank + CITY_WATERFRONT_FADE, dist)) * (1 - smoothstep(farthest - CITY_WATERFRONT_FADE, farthest, dist));
    wf = Math.max(wf, drowned * near);
    dry = Math.min(dry, dist + CITY_WATERFRONT_PENALTY * smoothstep(CITY_WATERFRONT_BELT_HOLD, 1, drowned));
  }
  if (wf <= 0) {
    waterfrontBelt.distance = dry;
    return;
  }
  // Off the city the line is pushed away with the distance from the wall: it would run on along the
  // river past the city's corner, into the grass.
  // Where the waterfront barely starts (wf → 0) the line is pushed out of play: 45u off at most, it took
  // the belt over the moment any wall was drowned at all — 0.3u curb steps along that line.
  const fadeIn = CITY_WATERFRONT_ABSENT * (1 - smoothstep(0, CITY_WATERFRONT_ONSET, wf));
  const line = Math.abs(quay.distance - (reach * quay.factor + fw)) + CITY_WATERFRONT_PENALTY * (1 - smoothstep(0, 1, wf)) + fadeIn + (inCity ? 0 : CITY_WATERFRONT_OUTSIDE_PUSH * beltDistance);
  waterfrontBelt.distance = smoothMin(dry, line, CITY_WATERFRONT_FILLET);
  waterfrontBelt.waterfront = wf;
  waterfrontBelt.onWaterfront = line < dry;
};

/** The belt's distance from a point OFF the city (real units, from the nearest city wall's
 *  `beltDistance`): the city's own measure, its waterfront line fading off the wall, so where the river
 *  drowns a wall the outer half is pushed off it exactly as the inner half is. riverQuayAt must have run. */
export const drownedBeltDistance = (wx: number, wz: number, walls: Wall[], beltDistance: number, quay: RiverQuaySample): number => {
  findWaterfrontBelt(wx, wz, walls, beltDistance, quay, false);
  return waterfrontBelt.distance;
};
