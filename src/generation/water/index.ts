/**
 * WATER in the height pipeline (computeVertexData step 4; world/water/README.md): the ONE composition
 * of every body of water at a vertex, in one order — AREA water first (a lake's level and the shore
 * lift, lakes/), then CHANNEL water (the river field's channel, surface, bed and flow: rivers/, carved
 * by ./channel/) with its WALLS, then the JOINS between the two (./joins/: a mouth, the hold beside quays,
 * a river merging into the lake beside it), and last whose water — or bank — each vertex is. Everything
 * that reads water reads its result (the vertex's waterHeight, waterDepth and flow). Three-free.
 *
 * Like every pipeline module it imports the others in a cycle (generation/index.ts): no export of theirs is
 * used at this module's top level.
 */

import { smoothstep } from "../../utils/math";
import { RIVER_BED_FULL_INSET } from "../../world/shaders/constants";
import { domainConfig } from "../store";
import { ZONE_WEIGHT_EPS } from "../zones/constants";
import { zoneFinal, zoneMinDist, zones } from "../zones/blend";
import { bankReliefAt, carveRiverChannel, carveRiverWall, NO_BANKS, riverWaterBand } from "./channel";
import { ROAD_FADE_FAR, ROAD_FADE_NEAR, SHORE_RISE } from "./constants";
import { drawnRiverWater, holdRiverBesideQuays, lastMergeLevel, lastMouthShare, mergeFloor, riverLakeMerge } from "./joins";
import { lakeSurface, shoreLift } from "./lakes";
import { isLakeBiome, lakeBodyOf } from "./lakes/params";
import { capRiverBed, currentRiverShape, riverBodyOf, riverField, type RiverFieldSample } from "./rivers";
import { freewayHalfWidth } from "./utils";
import type { BankRelief, WallShape, WaterContext } from "./types";

/** What resolveWater last composed for its vertex. `riverSurface` is the river's surface held beside
 *  quays (NaN off every channel), `lakeLevel` the lake drawn there before any river (NaN: none), `channel`
 *  1 on open ground and 0 in a channel's water band; `bank` and `channelDepth` are the channel's levee
 *  relief and depth scale (what a road's approach is held up by, step 5). */
export const water = {
  height: 0,
  waterHeight: NaN,
  lakeLevel: NaN,
  riverSurface: NaN,
  mouth: 0,
  riverBedDistance: 0,
  flowX: 0,
  flowZ: 0,
  channel: 1,
  bank: NO_BANKS as BankRelief,
  channelDepth: 1,
  body: -1,
  bodyShare: 0,
  body2: -1,
};

/** Between the steps of one resolveWater: the ground before any river carved it, the river's own water as
 *  drawn (NaN outside its band), the lake's body there, and how much of the vertex merged into the lake. */
const step = { groundBeforeRiver: 0, riverWater: NaN, lakeBody: -1, merge: 0 };

/** The <Lake> the lake water at the current wall pass belongs to: the own zone's where it is one,
 *  else the heaviest lake zone in reach (the nearest where none weighs: a shore's water). */
const lakeBodyHere = (): number => {
  let best = -1;
  let bestWeight = 0;
  let bestDist = Infinity;
  for (let i = 0; i < zones.length; i++) {
    if (!isLakeBiome(zones[i].biome)) continue;
    const w = zoneFinal[i] >= ZONE_WEIGHT_EPS ? zoneFinal[i] : 0;
    if (w > bestWeight || (bestWeight === 0 && w === 0 && zoneMinDist[i] < bestDist)) {
      best = i;
      bestWeight = w;
      bestDist = zoneMinDist[i];
    }
  }
  return best < 0 ? -1 : lakeBodyOf(zones[best].biome.id);
};

/** AREA: a lake's level and the shore lift. NaN where no water is in reach (the water mesh dives under the
 *  ground). */
const resolveArea = (ctx: WaterContext, field: RiverFieldSample): void => {
  const level = lakeSurface(ctx.biome.warped, ctx.biome, ctx.biome.zone);
  water.waterHeight = level;
  water.lakeLevel = level;
  step.lakeBody = Number.isNaN(level) && !(field.shore < Infinity) ? -1 : lakeBodyHere();
  const dip = ctx.streetCurbDip;
  if (dip > 0) {
    // A street's curb dips UNDER a shore lift, as the belt's outer half dips under its lifted grade
    // (step 5): lifted with it, the road stood level with the lake side's curb 0.3u below it.
    const lifted = shoreLift(water.height + dip);
    if (lifted !== water.height + dip) water.height = lifted - dip;
  } else water.height = shoreLift(water.height);
  step.groundBeforeRiver = water.height;
};

/** CHANNEL: the river's surface (held beside quays), its bed's limit, the carve and the flow, downhill
 *  along it (world/water). */
const resolveChannel = (ctx: WaterContext, field: RiverFieldSample, reach: number, band: number): void => {
  const { distance } = ctx;
  const surface = distance < reach ? holdRiverBesideQuays(field.surface) : NaN;
  water.riverSurface = surface;
  // The bed ends at its steep bank's limit (generation/water/rivers/bed-limit/index.ts) — not where the biome keeps its own
  // banks, phasing in over the handoff just outside one's wall, where its quay's rule hands over.
  if (!(ctx.ownBanksWeight > 0) && water.riverBedDistance < reach) {
    water.riverBedDistance += (capRiverBed(water.riverBedDistance, field.bedLimit) - water.riverBedDistance) * ctx.riverBanksShare;
  }
  water.mouth = 0;
  water.flowX = 0;
  water.flowZ = 0;
  step.riverWater = NaN;
  if (Number.isNaN(surface)) return;
  // JOIN, a mouth: over the ground already under the lake drawn here the river only deepens the lakebed —
  // no rim, the lake's level, the lake's paint.
  const drawn = drawnRiverWater(surface, water.height, water.waterHeight);
  const mouth = lastMouthShare();
  water.mouth = mouth;
  const carved = carveRiverChannel(water.height, distance, surface, ctx.factor, water.bank, water.channelDepth);
  water.height = carved + (Math.min(carved, water.height) - carved) * mouth;
  water.riverBedDistance += (Math.max(water.riverBedDistance, reach) - water.riverBedDistance) * mouth;
  if (distance < band) {
    step.riverWater = drawn;
    water.waterHeight = Number.isNaN(water.waterHeight) ? drawn : Math.max(water.waterHeight, drawn);
  }
  // The flow fades across the dry bank: a water sheet's edge triangle never runs from full flow to none
  // within one quad (the shader's advection sheared its noise into lines along every bank).
  const flowShare = (1 - mouth) * (1 - smoothstep(band, reach, distance));
  water.flowX = field.flowX * flowShare;
  water.flowZ = field.flowZ * flowShare;
};

/** WALLS: every river's and pond's walls slope back from its water into the natural ground (./channel; a
 *  pond in a notch sat between walls) — not where the biome keeps its own banks (fading out into it with the
 *  bed limit's handoff), and away from the city's belt (`roadClear`). Under an inter-city run they carve
 *  too: a run's grade rides the carved ground, and spared, its strip stood as a ridge up to 150u over a
 *  mountain the walls had cut down around it. Never under the water drawn here: each
 *  wall stands on its own run's water, which beside a confluence can lie under the blended surface the
 *  channel draws — the floor fades out across the bank. */
const cutWalls = (ctx: WaterContext, runs: WallShape, reach: number, band: number, roadClear: number): void => {
  const share = (ctx.ownBanksWeight > 0 ? 1 - ctx.ownBanksWeight : ctx.riverBanksShare) * roadClear;
  if (!(share > 0) || ctx.walls.length === 0) return;
  const height = water.height;
  let cut = carveRiverWall(height, ctx.walls, runs);
  if (!Number.isNaN(water.riverSurface)) {
    const floored = Math.max(cut, Math.min(height, water.riverSurface + SHORE_RISE));
    cut += (floored - cut) * (1 - smoothstep(band, reach, ctx.distance));
  }
  water.height = height + (cut - height) * share;
};

/** JOIN, a merge: a river BESIDE a lake MERGES with it (./joins riverLakeMerge): the land between goes under
 *  the level, sunk to the channel's floor, painted as bed. Never where the biome keeps its own banks, nor
 *  near a freeway or such a biome's wall (even where a drowned belt is pushed off it): quays, the belt, a
 *  run along the shore and every deck's landing stay dry. */
const mergeIntoLake = (ctx: WaterContext, field: RiverFieldSample, riversDepth: number, reach: number, fw: number, roadClear: number): void => {
  step.merge = 0;
  if (ctx.ownBanksWeight > 0 || !(field.shore < Infinity) || !(ctx.freewayDistance > fw + ROAD_FADE_NEAR)) return;
  const merge = roadClear * riverLakeMerge(step.groundBeforeRiver, ctx.distance, ctx.factor, field.surface, field.shore, field.level, domainConfig!.river, riversDepth);
  step.merge = merge;
  if (!(merge > 0)) return;
  water.height += (Math.min(water.height, mergeFloor()) - water.height) * merge;
  // The water comes onto the level with the share: in the band the river's own water eased there, outside
  // it the level (or, where the river runs under the lake, its sunk surface as the share fades) —
  // continuous wherever the share reaches 0.
  const level = lastMergeLevel();
  const riverWater = step.riverWater;
  const merged = Number.isNaN(riverWater) ? level + Math.min(0, field.surface - level) * (1 - merge) : riverWater + (level - riverWater) * merge;
  water.waterHeight = Number.isNaN(water.lakeLevel) ? merged : Math.max(water.lakeLevel, merged);
  water.riverBedDistance += (Math.min(water.riverBedDistance, reach - RIVER_BED_FULL_INSET) - water.riverBedDistance) * merge;
};

const setBodies = (body: number, share: number, body2: number): void => {
  water.body = body;
  water.bodyShare = body < 0 ? 0 : body2 < 0 ? 1 : share;
  water.body2 = body2;
};

/** WHOSE water — or bank — it is (the zone rule's owner, generation/water/parts/params.ts): the channel's in its band (a
 *  pond's own, else the river's), less what a mouth or a merge hands to the lake; the lake's elsewhere in
 *  its level's reach; and where no water is drawn, the channel's across its bank. */
const resolveOwners = (ctx: WaterContext, field: RiverFieldSample): void => {
  const channel = Number.isNaN(water.riverSurface) ? -1 : field.body >= 0 ? field.body : riverBodyOf(ctx.biome.zone.biome.id);
  const merge = step.merge;
  const channelShare = Number.isNaN(step.riverWater) ? 0 : Number.isNaN(water.lakeLevel) && merge === 0 ? 1 : (1 - water.mouth) * (1 - merge);
  if (Number.isNaN(water.waterHeight)) setBodies(channel, 1, -1);
  else if (channelShare >= 0.5) setBodies(channel, channelShare, channelShare < 1 ? step.lakeBody : -1);
  else setBodies(step.lakeBody, 1 - channelShare, channelShare > 0 ? channel : -1);
};

/** Step 4 of computeVertexData for the vertex whose wall pass is current (`ctx`; the rest of the river
 *  field as step 2 left it). Writes `water`. */
export const resolveWater = (ctx: WaterContext): void => {
  const river = domainConfig!.river;
  const fw = freewayHalfWidth();
  const reach = river.halfWidth + river.bank;
  const band = riverWaterBand(river);
  const field = riverField();
  const rivers = currentRiverShape();
  // The merge fades in past a freeway's half-width, the walls past the belt's.
  const roadClear = smoothstep(fw + ROAD_FADE_NEAR, fw + ROAD_FADE_FAR, ctx.freewayDistance);
  const beltClear = smoothstep(fw + ROAD_FADE_NEAR, fw + ROAD_FADE_FAR, ctx.beltDistance);
  water.height = ctx.height;
  water.riverBedDistance = ctx.riverBedDistance;
  // The channel's depth: a disc's kind where the discs weigh, the rivers' <Rivers depth> for the rest.
  water.channelDepth = ctx.discDepth + (rivers.depth - 1) * (1 - ctx.pondShare);
  water.bank = ctx.distance < reach ? bankReliefAt(ctx.x, ctx.z, ctx.pondBody, ctx.pondShare, riverBodyOf) : NO_BANKS;
  resolveArea(ctx, field);
  resolveChannel(ctx, field, reach, band);
  cutWalls(ctx, rivers, reach, band, beltClear);
  mergeIntoLake(ctx, field, rivers.depth, reach, fw, roadClear);
  water.channel = Number.isNaN(water.riverSurface) ? 1 : smoothstep(band, reach, ctx.distance);
  resolveOwners(ctx, field);
};
