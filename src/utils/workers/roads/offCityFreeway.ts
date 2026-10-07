/**
 * Step 5 of computeVertexData (CLAUDE.md "Inter-city freeways and bridges"): the freeways OUTSIDE the
 * city — the inter-city runs and the outer half of every city's belt — graded, curb-dipped and given
 * the city's normalized road field, yielding to rivers, so the city road shader paints them as one
 * surface with the city's rim.
 */

import { smoothstep } from "../../math/_math";
import { runRiverYield } from "../bridges/constants";
import { domainConfig } from "../computeConfig";
import { riverMouthShare } from "../lakes";
import { unwarp } from "../noise";
import { carveRiverChannel, riverWaterBand } from "../rivers/riverChannel";
import { riverQuay, riverQuayAt } from "../rivers/riverField";
import type { BiomeContext, Wall, Zone } from "../types";
import { blendedTerrainAt } from "../vertexCompute";
import { CITY_QUAY_INNER_CAP, NO_ROAD_DISTANCE, cityCurbDip } from "./cityRoadField";
import { wallDrownedAt } from "./cityWaterfront";
import { FREEWAY_GRADE_RAMP } from "./freewayGrade";
import { nearestRun } from "./freewayNetwork";

/** Within freewayWidth + this of BOTH a run and a city wall, the two roads are merging: no lane paint. */
export const FREEWAY_MERGE_CLEAR = 12;
/** A deck landing's approach lays its road flat this far past the freeway's half-width (real units,
 *  warped like every road distance) before its shoulder: past the deck's sides (BRIDGE_DECK_MARGIN)
 *  wherever the road warp stretches them out to ~1.4× (a ramp end measured 21 at the deck's side). */
export const APPROACH_WIDEN = 8;
/** …and its shoulder meets the ground over this, gentler than a road's own FREEWAY_GRADE_RAMP: a landing's
 *  approach often stands units over a bank the river carved, and at 10u that edge measured 2–7u kinks. */
export const APPROACH_SHOULDER = 30;
/** How far from a freeway centerline the normalized road distance is still written (real units). */
export const FREEWAY_FIELD_REACH = 70;
/** How far past a river's footprint (real units) a vertex can still read a city wall the river drowns:
 *  the belt's field reach, plus the freeway's half-width (14) and the waterfront's fade (30, cityTerrain)
 *  a drowned wall lies within, and a margin for the meander. */
export const BELT_DROWN_READ = FREEWAY_FIELD_REACH + 64;
/** A road's field is pushed off the pavement over the last this many (factor-1) units of the zone
 *  it yields to a river in: continuous, so the road ends in a clean curbed line under the deck. */
const ROAD_RIVER_RAMP = 16;
/** Past the river's footprint by this much (factor-1 units) the belt's straight river distance is
 *  still worth asking for: the meander moves the footprint's edge by at most RIVER_MEANDER_AMP. */
const BELT_STRAIGHT_REACH = 30;
/** A road's field meets the river's push (step 5) over about this much (street units): a LOD1
 *  vertex spacing of the freeway's field (4.375u × roadWidth / freewayWidth ≈ 2.2), and a margin. */
const ROAD_PUSH_SMOOTH = 5;
/** The river's push on a road's field grows no further than this (street units): far past the pavement. */
const ROAD_PUSH_CAP = 40;
/** A smooth maximum of a road's field and the river's push on it; the rounding fades in with the push
 *  itself, so where the push begins the field is exactly the road's. */
const smoothMaxRoad = (a: number, push: number): number => {
  const k = ROAD_PUSH_SMOOTH * smoothstep(0, ROAD_PUSH_SMOOTH, push);
  if (k <= 0) return Math.max(a, push);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (push - a)) / k));
  return a + (push - a) * h + k * h * (1 - h);
};

/** The nearest city wall — the belt seen from OUTSIDE the city: distance (the belt's: step 2 pushes it
 *  off a drowned wall), the wall's own distance, along coordinate, closest point. */
export const nearestCityWall = { distance: Infinity, wall: Infinity, along: 0, x: 0, z: 0 };
export const findNearestCityWall = (px: number, pz: number, walls: Wall[]): void => {
  nearestCityWall.distance = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < nearestCityWall.distance) {
      nearestCityWall.distance = d;
      nearestCityWall.wall = d;
      nearestCityWall.along = t * Math.sqrt(lenSq) + w.sx + w.sz;
      nearestCityWall.x = cx;
      nearestCityWall.z = cz;
    }
  }
};

/** Over this far off the wall (real units) the belt's field beside a river hands over from the city's
 *  own rule to a smooth maximum that never paints the quay's bands out into the neighbor. */
export const BELT_FIELD_HANDOFF = 6;
/** The belt's road field beside a river, `normalized` (street units) and `wall` (real units) off its
 *  wall: ON the wall exactly the city's (getCityTerrain: the belt's field lerped toward the quay's own
 *  by its river-side fade), so the pavement's edges (7, 8, 12) and the curb dip cross the wall at the
 *  same distances — a smooth maximum alone stood the curb 0.15u apart there — and off it a smooth
 *  maximum (the city's lerp, carried on, would draw the quay's sidewalk band 70u into the grass). */
const beltQuayField = (normalized: number, wall: number): number => {
  const rv = domainConfig!.river;
  const rw = domainConfig!.cityConfig.roadWidth;
  const quayOffset = (rv.halfWidth + rv.bank) * riverQuay.factor + rw;
  if (riverQuay.distance >= quayOffset) return normalized;
  const only = Math.min(CITY_QUAY_INNER_CAP, quayOffset - riverQuay.distance);
  const riverSide = 1 - smoothstep(quayOffset - rw, quayOffset - rw * 0.5, riverQuay.distance);
  const cityRule = normalized + (only - normalized) * riverSide;
  return cityRule + (smoothMaxRoad(normalized, only * riverSide) - cityRule) * smoothstep(0, BELT_FIELD_HANDOFF, wall);
};

/** What gradeOffCityFreeway computed for the current vertex (read right after the call). */
export const offCityRoad = { height: 0, roadField: NO_ROAD_DISTANCE, freewayField: NO_ROAD_DISTANCE, freewayAlong: 0, laneEndGap: Infinity, approachDelta: 0 };

/** Step 5: the freeways OUTSIDE the city — the inter-city runs and the OUTER HALF of every city's belt
 *  (centered on the wall) — as one grade, one curb dip and one normalized road field, so the city road
 *  shader paints them as one surface with the city's rim. Reads step 2's nearestRun / nearestCityWall /
 *  roadReal / roadGrade and writes offCityRoad. */
export const gradeOffCityFreeway = (
  height: number,
  cvx: number,
  cvz: number,
  own: Zone,
  ctx: BiomeContext,
  roadReal: number,
  roadGrade: number,
  distanceToRiver: number,
  riverFactor: number,
  riverSurface: number,
  lakeLevel: number,
): void => {
  const river = domainConfig!.river;
  const cityCfg = domainConfig!.cityConfig;
  const fw = cityCfg.freewayWidth;
  const riverReach = river.halfWidth + river.bank;
  const waterBand = riverWaterBand(river);
  let roadField = NO_ROAD_DISTANCE;
  let freewayField = NO_ROAD_DISTANCE;
  let freewayAlong = 0;
  let laneEndGap = Infinity;
  let approachDelta = 0;
  // Near a river: the belt's STRAIGHT river distance (the yield below), and whether its wall is
  // drowned — then the city's WATERFRONT carries the belt on (getCityTerrain) and this outer half,
  // inside the waterfront's band, keeps no lane paint of its own.
  const beltDist = nearestCityWall.distance;
  let beltStraight = Infinity;
  let beltDrowned = false;
  if (distanceToRiver < riverReach + BELT_STRAIGHT_REACH && beltDist < FREEWAY_FIELD_REACH) {
    riverQuayAt(cvx, cvz);
    if (riverQuay.distance < Infinity) {
      beltStraight = riverQuay.distance / riverQuay.factor;
      beltDrowned = wallDrownedAt(nearestCityWall.x, nearestCityWall.z) > 0.5;
    }
  }
  const onBelt = beltDist < nearestRun.distance;
  // Where the road yields to a river: the belt's outer half across the whole footprint, an inter-city
  // RUN only near the water (runRiverYield — a run grazing a river's outer bank stays a road).
  // Blended where the two roads meet, so the field never jumps.
  const runShare = smoothstep(-8, 8, beltDist - nearestRun.distance);
  const yieldAt = riverReach + (runRiverYield() - riverReach) * runShare;
  // The belt also yields by the STRAIGHT river distance, as the city's side of it does (quay and
  // waterfront): by the meandered one alone, a strip of belt stands in the sand where the channel
  // wanders off.
  const roadRiver = beltStraight < Infinity ? Math.min(distanceToRiver, distanceToRiver + (beltStraight - distanceToRiver) * (1 - runShare)) : distanceToRiver;
  const roadChannel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, yieldAt, roadRiver);
  if (distanceToRiver < Infinity) laneEndGap = (roadRiver - yieldAt) * riverFactor;
  const roadAlong = onBelt ? nearestCityWall.along : nearestRun.along;
  const roadPx = onBelt ? nearestCityWall.x : nearestRun.x;
  const roadPz = onBelt ? nearestCityWall.z : nearestRun.z;
  // Where a run meets the belt, neither carries lane paint (the mouth of the merge).
  const merging = nearestRun.distance < fw + FREEWAY_MERGE_CLEAR && beltDist < fw + FREEWAY_MERGE_CLEAR;
  // Written CONTINUOUSLY out to FREEWAY_FIELD_REACH: the shader's corridor mask (8–9.5 street units)
  // interpolates it per vertex, so a NO_ROAD_DISTANCE beside a 9 would alias the corridor's edge into the grid.
  if (roadReal < FREEWAY_FIELD_REACH) {
    let normalized = roadReal * (cityCfg.roadWidth / fw);
    // Where the road yields to the river it is on a DECK: its field is pushed past the pavement band
    // so the ground under it shows sand. The push ramps in LINEARLY over the zone's last
    // ROAD_RIVER_RAMP units, inside the deck's cover (a hard jump, or a ramp flattening near the
    // sidewalk's edge, steps along the LOD triangles), and joins the road's field by a SMOOTH maximum
    // (a plain max() creases it the same way).
    const pushFull = cityCfg.roadWidth + 6;
    const runPush = distanceToRiver < yieldAt ? Math.min(ROAD_PUSH_CAP, (pushFull * (yieldAt - distanceToRiver)) / ROAD_RIVER_RAMP) : 0;
    const runField = runPush > 0 ? smoothMaxRoad(normalized, runPush) : normalized;
    // The BELT gives way exactly as the city's side of it does (getCityTerrain's quay river side: by
    // the straight river distance, a unit per unit past the bank's edge), so its pavement's edges
    // (7, 8, 12) cross the wall at the same distances on both sides.
    const beltField = beltStraight < Infinity ? beltQuayField(normalized, nearestCityWall.wall) : normalized;
    normalized = beltField + (runField - beltField) * runShare;
    if (normalized < roadField) roadField = normalized;
  }
  const graded = roadReal < fw + FREEWAY_GRADE_RAMP;
  if (graded || (roadReal < fw + APPROACH_WIDEN + APPROACH_SHOULDER && !Number.isNaN(roadGrade))) {
    // Flat across, riding the terrain along its centerline; it never fills a river channel (a deck
    // spans that). At a city wall the centerline sample is the city's own grade (weight 1 there).
    const rp = unwarp(roadPx, roadPz);
    const grade = Number.isNaN(roadGrade) ? blendedTerrainAt(rp.x, rp.z, own, ctx) : roadGrade;
    const normalized = roadReal * (cityCfg.roadWidth / fw);
    const dip = cityCurbDip(normalized);
    // The road as a deck landing's approach lays it (step 7, bridgeApproachAt): the same grade and curb,
    // NOT giving way to the river, and flat out past the deck's sides. The yield follows the vertex's
    // own river distance, so where a river meets the road obliquely it crosses the road diagonally —
    // half the road at its grade, half carved down the bank — and the deck, wider than the road's flat,
    // sat on its falling shoulder: pits and mounds in front of a cut end, a trench under a ramp.
    const approach = height + (grade - dip - height) * (1 - smoothstep(fw + APPROACH_WIDEN, fw + APPROACH_WIDEN + APPROACH_SHOULDER, roadReal));
    if (graded) {
      const ramp = 1 - smoothstep(fw, fw + FREEWAY_GRADE_RAMP, roadReal);
      const runHeight = height + (grade - dip - height) * ramp * roadChannel;
      if (runShare < 1 && (beltStraight < Infinity || !Number.isNaN(riverSurface))) {
        // The belt's OUTER half beside a river is what the city's inner half is at the wall: the grade
        // with the curb dip of the quay-aware field, carved by the river like any city ground (the
        // bank blends into the road, a mouth only deepens) — yielding by roadChannel instead stood the
        // outer half up to 2.7u off the city's side of the wall.
        const beltDip = cityCurbDip(beltStraight < Infinity ? beltQuayField(normalized, nearestCityWall.wall) : normalized);
        let ground = grade - beltDip;
        if (!Number.isNaN(riverSurface)) {
          const carved = carveRiverChannel(ground, distanceToRiver, riverSurface, riverFactor);
          const mouth = riverMouthShare(ground, lakeLevel);
          ground = mouth > 0 ? carved + (Math.min(carved, ground) - carved) * mouth : carved;
        }
        const beltHeight = height + (ground - height) * ramp;
        height = runShare > 0 ? beltHeight + (runHeight - beltHeight) * runShare : beltHeight;
      } else height = runHeight;
      // No lane paint on the riverbed under a deck, nor in a merge.
      if (roadChannel > 0.999 && !merging && !(onBelt && beltDrowned)) {
        freewayField = roadReal;
        freewayAlong = roadAlong;
      }
    }
    // (Not over a lake: a causeway's approach would fill the lakebed beside it.)
    if (!own.biome.water) approachDelta = approach - height;
  }
  offCityRoad.height = height;
  offCityRoad.roadField = roadField;
  offCityRoad.freewayField = freewayField;
  offCityRoad.freewayAlong = freewayAlong;
  offCityRoad.laneEndGap = laneEndGap;
  offCityRoad.approachDelta = approachDelta;
};
