/**
 * THE height pipeline (CLAUDE.md: "Heights have a single source of truth"): one vertex evaluation
 * (computeVertexData) over the modules beside this file — noise, the voronoi grids, the zone wall
 * pass, lakes, flatten pads, and the rivers/, roads/ and bridges/ folders — run identically by every
 * worker, the main thread and the server. Three-free.
 *
 * This file is also the pipeline's PUBLIC API: every caller outside utils/workers/ imports from here
 * (the re-exports at the bottom), never from the modules themselves.
 *
 * The modules import each other in CYCLES (a river surface samples the terrain, the terrain samples
 * the rivers), which ES modules, esbuild and babel-jest all resolve — as long as no module USES
 * another pipeline module's export at its own top level (a constant derived from one would read it
 * before it is initialized). Values cross modules only inside functions.
 */

import { smoothstep } from "../math/_math";
import type { PointXZ } from "../math/types";
import { CITY_BIOME_ID } from "../../world/constants";
import { clearBridgeCaches, enumeratingBridges } from "./bridges/freewayBridges";
import { LANE_END_CLEAR, NO_DECKS, clearDeckCells, cutGroundUnderDecks, deckEndNear, deckGround, decksAround } from "./bridges/deckGround";
import { runRiverYield } from "./bridges/constants";
import { domainConfig, setDomainConfig } from "./computeConfig";
import { applyFlattenPads, computeVertexDataRaw, evaluatingPadCandidates, initFlattenPads, padsApplyIn } from "./flattenPads";
import { SHORE_RISE, clearLakeCaches, lakeLevelAt, lakeSurface, shoreLift } from "./lakes";
import { biomeNoiseHeight, terrainNoise, unwarp, warp } from "./noise";
import { initPlaces } from "./places";
import { initRivers } from "./rivers/riverNetwork";
import { clearRiverField, noRiverQuay, noRiverSample, riverFieldAt, riverQuay, riverQuayAt, riverSample } from "./rivers/riverField";
import { CITY_QUAY_INNER_CAP, type CityTerrain, clearCityCaches, getCityTerrain, wallDrownedAt } from "./roads/cityTerrain";
import { FREEWAY_GRADE_RAMP, clearFreewayGrades, freewayGradeAt } from "./roads/freewayGrade";
import { FREEWAY_SMIN_K, type WallNetwork, clearNetworkCache, nearestFreewayRun, nearestRun, networkOf, smoothMin } from "./roads/freewayNetwork";
import { FRAGMENT_REMOVED_FIELD, FRAGMENT_RIVER_REACH, clearRoadFragments, inRoadFragment } from "./roads/roadFragments";
import type { BiomeContext, DomainConfig, SerializedRegion, VertexResult, Wall, Zone } from "./types";
import { clearVoronoiCaches, getBiomeContext, wallsOfBiome } from "./voronoi";
import {
  ZONE_WEIGHT_EPS,
  accumulateWallFields,
  biomePresence,
  biomePresenceResult,
  biomeSdf,
  biomeSdfResult,
  combineZoneWeights,
  initZones,
  ownWallAlong,
  ownWallDistance,
  sstep01,
  zoneFinal,
  zoneMinDist,
  zoneWeights,
  zones,
} from "./zoneBlend";

/** Within freewayWidth + this of BOTH a run and a city wall, the two roads are merging: no lane paint. */
const FREEWAY_MERGE_CLEAR = 12;
/** How far from a freeway centerline the normalized road distance is still written (real units). */
const FREEWAY_FIELD_REACH = 70;
/** A road's field is pushed off the pavement over the last this many (factor-1) units of the zone
 *  it yields to a river in: continuous, so the road ends in a clean curbed line under the deck. */
const ROAD_RIVER_RAMP = 16;
/** A city vertex on the river side of the quay reports its riverbed paint distance at most this
 *  far inside the STRAIGHT bank edge (factor-1 units): past the fade the bed shader applies, so the
 *  sand begins exactly where the quay's river-side sidewalk ends (see riverBedDistance). */
const QUAY_BED_INSET = 3;
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

export function initCompute(config: DomainConfig): void {
  setDomainConfig(config);
  // Everything keyed by seed or by config-derived objects is stale across an init.
  clearVoronoiCaches();
  clearCityCaches();
  clearLakeCaches();
  clearNetworkCache();
  clearFreewayGrades();
  clearRiverField();
  clearDeckCells();
  clearRoadFragments();
  clearBridgeCaches();
  initRivers(config);
  initZones(config);
  initPlaces(config);
  initFlattenPads(config);
}

/** The initialized config's regions (voronoi order). */
export const getRegions = (): SerializedRegion[] => {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  return domainConfig.regions;
};

/** The nearest city wall — the belt seen from OUTSIDE the city: distance, along coordinate, closest point. */
const nearestCityWall = { distance: Infinity, along: 0, x: 0, z: 0 };
const findNearestCityWall = (px: number, pz: number, walls: Wall[]): void => {
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
      nearestCityWall.along = t * Math.sqrt(lenSq) + w.sx + w.sz;
      nearestCityWall.x = cx;
      nearestCityWall.z = cz;
    }
  }
};

/** The own zone's city terrain, when zoneBiomeHeight evaluated one for the current vertex. */
let ownCityTerrain: CityTerrain | null = null;

/** A zone's BIOME height at (x, z) (the region base is added by the caller), already
 *  scaled by the biome's PRESENCE: 0 at the biome's own edge (the region base shows),
 *  1 one height-blend width inside; a crisp biome (city) has presence 1 everywhere, so
 *  evaluated OUTSIDE its zone it continues at the belt freeway's grade — the value its
 *  own rim already holds at the wall (getCityTerrain) — and the neighbor's ramp starts
 *  on the road surface. Water biomes bowl `depth` below the base. */
const zoneBiomeHeight = (zone: Zone, x: number, z: number, isOwn: boolean, ctx: BiomeContext): number => {
  const presence = zone.crisp ? 1 : isOwn ? sstep01(zoneMinDist[zone.index] / zone.heightPresenceWidth) : 0;
  if (zone.biome.water) {
    // Relative to the LEVEL, not the base: the shore (presence 0, both sides of the wall)
    // stands SHORE_RISE above the water and the bowl descends to depth below it.
    const level = lakeLevelAt(ctx.warped, ctx.grid);
    if (Number.isNaN(level)) return -zone.biome.water.depth * presence;
    return level + SHORE_RISE - (zone.biome.water.depth + SHORE_RISE) * presence - terrainNoise(zone.baseNoise, x, z);
  }
  if (presence <= 0) return 0;
  const noiseConfig = domainConfig!.biomeNoiseConfigs[zone.biome.id];
  if (noiseConfig) return biomeNoiseHeight(noiseConfig, x, z) * presence;
  if (domainConfig!.cityConfig && zone.biome.id === CITY_BIOME_ID) {
    if (!isOwn) return domainConfig!.cityConfig.maxBlockElevation * 0.5;
    if (farDry) noRiverQuay();
    else riverQuayAt(ctx.warped.x, ctx.warped.z);
    const city = getCityTerrain(x, z, domainConfig!.cityConfig, wallsOfBiome(ctx.zoneWalls, CITY_BIOME_ID), ownWallDistance, ownWallAlong, riverQuay, ctx.warped);
    ownCityTerrain = city;
    return city.relativeElevation;
  }
  return 0;
};

/** The zone-weighted terrain (region bases + presence-scaled biome heights) at a point,
 *  using the CURRENT vertex's weights and presences — what a road grade or a river
 *  surface samples at its centerline without a second wall pass. */
export const blendedTerrainAt = (x: number, z: number, own: Zone, ctx: BiomeContext, cityHeight = domainConfig!.cityConfig.maxBlockElevation * 0.5): number => {
  let h = 0;
  for (let i = 0; i < zones.length; i++) {
    const w = zoneFinal[i];
    if (w < ZONE_WEIGHT_EPS) continue;
    const zone = zones[i];
    // The city's height is its rim grade seen from a road (the exact plateau needs its own wall
    // pass); a river surface samples the plateau FLOOR instead (cityHeight 0), so no block can
    // sit under it.
    const biomeHeight = zone.biome.id === CITY_BIOME_ID ? cityHeight : zoneBiomeHeight(zone, x, z, zone === own, ctx);
    h += w * (terrainNoise(zone.baseNoise, x, z) + biomeHeight);
  }
  return shoreLift(h);
};

/** The zone-blended terrain (no roads, no rivers, the city at `cityHeight`, default its rim grade) at
 *  a point, with the point's OWN wall pass and shore — what a road grade samples along its
 *  centerline. `world` is the point `warped` came from. Clobbers the wall-pass scratch and the shore
 *  state. */
export const terrainAtWarped = (warped: PointXZ, world: PointXZ, cityHeight?: number): number => {
  const c = getBiomeContext(warped);
  accumulateWallFields(warped.x, warped.z, c.zoneWalls, c.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, c, c.zone);
  return blendedTerrainAt(world.x, world.z, c.zone, c, cityHeight);
};

/** terrainAtWarped at a world point, the city at its rim grade. */
export const terrainOnlyAt = (x: number, z: number): number => terrainAtWarped(warp(x, z), { x, z });

/** Real distance from a world point to the nearest FREEWAY centerline — a city arterial or belt, an
 *  inter-city run — junction zones included (the lane-paint distance blanks them): whether a deck
 *  lands on a freeway. */
export const freewayDistanceAt = (x: number, z: number): number => {
  computeVertexDataRaw(x, z);
  const city = ownCityTerrain as CityTerrain | null;
  const inCity = city ? city.freewayReal : Infinity;
  const w = warp(x, z);
  const ctx = getBiomeContext(w);
  nearestFreewayRun(w.x, w.z, networkOf(ctx).freeways);
  findNearestCityWall(w.x, w.z, wallsOfBiome(ctx.zoneWalls, CITY_BIOME_ID));
  return Math.min(inCity, nearestRun.distance, nearestCityWall.distance);
};

/** Set while a FAR VISUAL-ONLY terrain vertex is evaluated (computeVertexDataFar). */
let farVisual = false;
/** Set while a far vertex is evaluated WITHOUT the river field (computeVertexDataFar, rivers = false). */
let farDry = false;
const NO_RUNS: WallNetwork["freeways"] = [];

/** A vertex of a far visual-only terrain LOD (LOD3–5: 210–3360u spacing, no collider): pad-free
 *  like computeVertexDataRaw, and blind to the inter-city freeway RUNS — a 14u road cannot be
 *  resolved between such vertices, and routing the runs was half of the startup ring's worker
 *  time. With `rivers` false (LODLevel.carvesRivers) it is blind to the river field too: no
 *  channel, no river water, no bed paint, no quay — the un-carved terrain. The belt, the city and
 *  everything else are exact; physics, the server and the main thread never take this path, and
 *  the skirts cover the difference at the seams (CLAUDE.md). */
export function computeVertexDataFar(x: number, z: number, rivers = true): VertexResult {
  farVisual = true;
  farDry = !rivers;
  try {
    return computeVertexDataRaw(x, z);
  } finally {
    farVisual = false;
    farDry = false;
  }
}

export function computeVertexData(x: number, z: number): VertexResult {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const river = domainConfig.river;

  // The decks whose ground this vertex may have to cut (step 7) — fetched FIRST: enumerating a cell's
  // decks evaluates the terrain (their landed ends), which clobbers every scratch buffer below.
  const decksKnown = !evaluatingPadCandidates && enumeratingBridges === 0;
  const cellDecks = decksKnown ? decksAround(x, z) : NO_DECKS;

  // Step 1: the road-noise warp — every grid, wall, road and river lives in warped space.
  const currentVertex = warp(x, z);
  const cvx = currentVertex.x;
  const cvz = currentVertex.z;

  // Step 2: the biome cell (its zone carries the region), then everything that CLOBBERS the wall-pass
  // scratch, then the vertex's ONE wall pass. The river field comes first (building a cell's river
  // list evaluates the terrain at river centerlines); off the city, the nearest freeway (runs + the
  // belt's outer half) and — only where step 5 will use it — its grade at the centerline.
  const ctx = getBiomeContext(currentVertex);
  const own = ctx.zone;
  if (farDry) noRiverSample();
  else riverFieldAt(cvx, cvz);
  const distanceToRiver = riverSample.distance;
  const riverFactor = riverSample.factor;
  const offCity = own.biome.id !== CITY_BIOME_ID;
  const fw = domainConfig.cityConfig.freewayWidth;
  let roadReal = Infinity;
  let roadGrade = NaN;
  if (offCity) {
    // Runs never enter a water zone (the network forbids water walls); the belt's outer half DOES
    // ride over a lake neighbor, as a causeway on the city's grade above the water.
    if (own.biome.water) nearestRun.distance = Infinity;
    else nearestFreewayRun(cvx, cvz, farVisual ? NO_RUNS : networkOf(ctx).freeways);
    findNearestCityWall(cvx, cvz, wallsOfBiome(ctx.zoneWalls, CITY_BIOME_ID));
    // Smooth minimum: a run meets the belt with a filleted mouth instead of a sharp inside corner.
    roadReal = smoothMin(nearestCityWall.distance, nearestRun.distance, FREEWAY_SMIN_K);
    if (roadReal < fw + FREEWAY_GRADE_RAMP) roadGrade = freewayGradeAt(cvx, cvz, x, z, ctx, !farVisual);
  }
  accumulateWallFields(cvx, cvz, ctx.zoneWalls, own);
  const distanceToBiomeBoundary = ownWallDistance;

  // Step 3: Heights — every zone in reach, weighted by crispness precedence; each zone
  // rides ITS region's base noise, its biome height scaled by its presence.
  combineZoneWeights(zoneWeights, zoneFinal);
  const blend = zoneFinal[own.index];
  let height = 0;
  let distanceToRoadCenter = 99999; // normalized street units; set by the city field or step 5
  let distanceToFreewayCenter = 99999;
  let freewayAlong = 0;
  ownCityTerrain = null;
  for (let i = 0; i < zones.length; i++) {
    const w = zoneFinal[i];
    if (w < ZONE_WEIGHT_EPS) continue;
    const zone = zones[i];
    height += w * (terrainNoise(zone.baseNoise, x, z) + zoneBiomeHeight(zone, x, z, zone === own, ctx));
  }
  const city = ownCityTerrain as CityTerrain | null;
  // The riverbed PAINT distance. In a city the quay decides where the sand begins — right past its
  // river-side sidewalk, a band of constant width — so a city vertex reports at most the STRAIGHT
  // distance less QUAY_BED_INSET: past the shader's fade wherever the quay's field is on the river
  // side. The meandered distance alone leaves plaza concrete between the sidewalk and the sand
  // wherever the channel wanders away, and the sidewalk reads as bulging.
  let riverBedDistance = distanceToRiver;
  if (city !== null && riverQuay.distance < Infinity) riverBedDistance = Math.min(distanceToRiver, riverQuay.distance / riverQuay.factor - QUAY_BED_INSET);
  // How far a freeway's lane paint is from the river end of its road (real units): in a city the
  // quay road's centerline, off it where the road yields to the river (step 5). Step 7 ends the
  // paint LANE_END_CLEAR short of it where no deck carries the road on.
  let laneEndGap = Infinity;
  // The waterfront's own paint runs along the river and never ends at it.
  if (city !== null && riverQuay.distance < Infinity && !city.paintOnWaterfront) laneEndGap = riverQuay.distance - ((river.halfWidth + river.bank) * riverQuay.factor + domainConfig.cityConfig.roadWidth);
  if (city !== null) {
    distanceToRoadCenter = city.roadDistance;
    distanceToFreewayCenter = city.freewayDistance;
    freewayAlong = city.freewayAlong;
    // A run merging into the belt: no lane paint in the mouth, so the belt's line reads as
    // branching off instead of running through (same rule as the city's own interchanges).
    if (ownWallDistance < fw + FREEWAY_MERGE_CLEAR) {
      nearestFreewayRun(cvx, cvz, farVisual ? NO_RUNS : networkOf(ctx).freeways);
      if (nearestRun.distance < fw + FREEWAY_MERGE_CLEAR) distanceToFreewayCenter = 99999;
    }
  }

  // Step 4: Water — a lake's level, then a river channel. NaN where none is in reach (the
  // water mesh dives under the ground).
  let waterHeight = lakeSurface(currentVertex, ctx, own);
  height = shoreLift(height);
  // River distances are in FACTOR-1 units: a wide river's channel, bank and paint all scale with
  // its width factor; depth grows with its root.
  const riverReach = river.halfWidth + river.bank;
  // The water is reported (and the bank held above it) out to here: past the waterline, so the
  // water mesh's shore triangles are level and meet the rising bank.
  const waterBand = river.halfWidth + river.bank * 0.5;
  const riverSurface = distanceToRiver < riverReach ? riverSample.surface : NaN;
  if (!Number.isNaN(riverSurface)) {
    // The channel is FORCED, not min'ed: a parabola from depth under the surface to a rim
    // SHORE_RISE above it at the half-width (the water's edge sits just inside), the bank blending
    // the rim into the terrain — raising low ground as well as cutting high ground (a min() alone
    // left low far banks under the water).
    const depth = river.depth * Math.sqrt(riverSample.factor);
    const rim = riverSurface + SHORE_RISE;
    // Ground LOWER than the rim is held at the rim across the whole band the water is reported in
    // (waterBand) and only then descends: blended down from the half-width, the bank sits under the
    // surface there and the water mesh draws a second strip on the dry bank.
    height =
      distanceToRiver < river.halfWidth
        ? rim - (depth + SHORE_RISE) * (1 - (distanceToRiver / river.halfWidth) ** 2)
        : rim + (height - rim) * smoothstep(height < rim ? waterBand : river.halfWidth, riverReach, distanceToRiver);
    if (distanceToRiver < waterBand) waterHeight = Number.isNaN(waterHeight) ? riverSurface : Math.max(waterHeight, riverSurface);
  }
  // 1 on open ground, 0 in the channel: what a road crossing the river yields to.
  const channel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, riverReach, distanceToRiver);
  // The city's arterials and belt cross the river on bridges (getFreewayBridges): no lane paint on
  // the riverbed.
  if (city !== null && channel < 0.999) distanceToFreewayCenter = 99999;

  // Step 5: Freeways OUTSIDE the city — the inter-city runs and the OUTER HALF of every
  // city's belt (centered on the wall): one grade, one curb dip, one normalized road
  // distance, so the city road shader paints them as one surface with the city's rim.
  // (nearestRun / nearestCityWall / roadReal are step 2's.)
  if (city === null) {
    const cityCfg = domainConfig.cityConfig;
    // Near a river the belt's straight river distance is asked for (the yield below), and whether
    // its wall is drowned: then the city's WATERFRONT carries the belt on (getCityTerrain), and the
    // outer half here keeps no lane paint of its own — it lies inside the waterfront's band.
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
    // Where the road yields to a river: the belt's outer half across the whole footprint (its inner
    // half is the city's, which the quay yields there), an inter-city RUN only near the water
    // (runRiverYield) — a run grazing a river's outer bank or a pond's stays a road, where decking it
    // made a deck along the shore and not decking it left a freeway dead-ending at the river. Blended
    // where the two roads meet, so the field never jumps.
    const runShare = smoothstep(-8, 8, beltDist - nearestRun.distance);
    const yieldAt = riverReach + (runRiverYield() - riverReach) * runShare;
    // The belt yields by the STRAIGHT river distance too — where the city's side of it does (its
    // quay and waterfront freeway, getCityTerrain): by the meandered one alone a strip of belt stands
    // in the sand between the waterfront and the water wherever the channel wanders off.
    const roadRiver = beltStraight < Infinity ? Math.min(distanceToRiver, distanceToRiver + (beltStraight - distanceToRiver) * (1 - runShare)) : distanceToRiver;
    const roadChannel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, yieldAt, roadRiver);
    if (distanceToRiver < Infinity) laneEndGap = (roadRiver - yieldAt) * riverFactor;
    const roadAlong = onBelt ? nearestCityWall.along : nearestRun.along;
    const roadPx = onBelt ? nearestCityWall.x : nearestRun.x;
    const roadPz = onBelt ? nearestCityWall.z : nearestRun.z;
    // Where a run meets the belt, neither carries lane paint (the mouth of the merge).
    const merging = nearestRun.distance < fw + FREEWAY_MERGE_CLEAR && beltDist < fw + FREEWAY_MERGE_CLEAR;
    // The normalized road distance is written CONTINUOUSLY out to FREEWAY_FIELD_REACH: it is a
    // per-vertex attribute the shader's corridor mask (8–9.5 street units) interpolates, and a
    // vertex left at 99999 beside one at 9 aliased the corridor's edge into the triangle grid.
    if (roadReal < FREEWAY_FIELD_REACH) {
      let normalized = roadReal * (cityCfg.roadWidth / fw);
      // Where the road yields to the river it is on a DECK: its field is pushed past the pavement
      // band so the bank and riverbed under it show sand, not asphalt. The push RAMPS in over the
      // zone's last ROAD_RIVER_RAMP units — a hard jump at its edge aliases into a sawtooth
      // asphalt/sand edge along the LOD triangles — and the ramp lies INSIDE the zone, which a deck
      // covers across the road's whole width (getFreewayBridges' wetness), so the road's curbed end is
      // never visible past a deck's end. The ramp is LINEAR, at about a road field's own slope, and
      // uncapped until well past the pavement: a ramp that flattens out near the sidewalk's edge (12)
      // puts the pavement's edge where the field barely changes, and it jumps a lattice step at a time
      // along the LOD1 triangles.
      const pushFull = cityCfg.roadWidth + 6;
      const runPush = distanceToRiver < yieldAt ? Math.min(ROAD_PUSH_CAP, (pushFull * (yieldAt - distanceToRiver)) / ROAD_RIVER_RAMP) : 0;
      // A SMOOTH maximum: a plain max() creases the field where the push takes over, and the curb's
      // band edge, interpolated across LOD1 triangles on either side of the crease, steps along the
      // triangle grid.
      const runField = runPush > 0 ? smoothMaxRoad(normalized, runPush) : normalized;
      // The BELT gives way exactly as the city's side of it does (getCityTerrain's quay river side: by
      // the STRAIGHT river distance, the field growing a unit per unit toward the river past the bank's
      // edge), so its pavement's edge crosses the wall without a step: any other function of the river
      // distance meets the city's side at the wall a lattice step off.
      // (Where the city's side is the quay's own field — the river side of its inner curb — this one is
      // too; past it the quay's field only raises the belt's where the belt's is lower, so no road
      // appears off the city: the pavement's edges (7, 8, 12) lie at the same distances on both sides.)
      let beltField = normalized;
      if (beltStraight < Infinity) {
        const quayOnly = Math.min(CITY_QUAY_INNER_CAP, riverReach * riverQuay.factor + cityCfg.roadWidth - riverQuay.distance);
        if (quayOnly > 0) beltField = smoothMaxRoad(normalized, quayOnly);
      }
      normalized = beltField + (runField - beltField) * runShare;
      if (normalized < distanceToRoadCenter) distanceToRoadCenter = normalized;
    }
    if (roadReal < fw + FREEWAY_GRADE_RAMP) {
      // The road rides the terrain along its centerline, flat across; it does NOT flatten a river
      // channel — a deck spans that (getFreewayBridges). At a city wall the centerline sample is
      // the city's own grade (its weight is 1 on the wall).
      const rp = unwarp(roadPx, roadPz);
      const grade = Number.isNaN(roadGrade) ? blendedTerrainAt(rp.x, rp.z, own, ctx) : roadGrade;
      const mask = (1 - smoothstep(fw, fw + FREEWAY_GRADE_RAMP, roadReal)) * roadChannel;
      // Normalized like the city's arterials so the shader bands, the curb dip and the spawn
      // filters (buildings ≥ 23) all read one road field.
      const normalized = roadReal * (cityCfg.roadWidth / fw);
      const dip = cityCfg.curbHeight * (1 - smoothstep(cityCfg.roadWidth - 2, cityCfg.roadWidth, normalized));
      height += (grade - dip - height) * mask;
      // No lane paint on the riverbed under a deck, nor in a merge.
      if (roadChannel > 0.999 && !merging && !(onBelt && beltDrowned)) {
        distanceToFreewayCenter = roadReal;
        freewayAlong = roadAlong;
      }
    }
  }

  // Step 6: flatten pads — skipped while evaluating pad candidates (defined
  // against the RAW terrain) and in biomes no flatten descriptor targets.
  // This RECURSES into computeVertexData (pad candidates), clobbering every scratch
  // buffer, so everything returned below was captured above — and the per-slot
  // buffers are copied into the result buffers the recursion never writes
  // (candidates run with evaluatingPadCandidates set and return the scratch itself).
  let sdfOut = biomeSdf;
  let presenceOut = biomePresence;
  if (!evaluatingPadCandidates) {
    biomeSdfResult.set(biomeSdf);
    biomePresenceResult.set(biomePresence);
    sdfOut = biomeSdfResult;
    presenceOut = biomePresenceResult;
    if (padsApplyIn(own.biome.id)) height = applyFlattenPads(x, z, height);
  }

  // Step 7: the ground under the decks (bridges/deckGround.ts).
  let underDeck = 0;
  if (cellDecks.length > 0) {
    deckGround.height = height;
    deckGround.roadField = distanceToRoadCenter;
    deckGround.freewayField = distanceToFreewayCenter;
    deckGround.waterHeight = waterHeight;
    cutGroundUnderDecks(cellDecks, x, z, city !== null, distanceToRiver);
    height = deckGround.height;
    distanceToRoadCenter = deckGround.roadField;
    distanceToFreewayCenter = deckGround.freewayField;
    waterHeight = deckGround.waterHeight;
    underDeck = deckGround.underDeck;
  }

  // Step 7b: a freeway that reaches a river with no deck to carry it on ENDS: its lane paint (and
  // with it the raised markers, which follow the paint) stops LANE_END_CLEAR short of the quay or
  // the bank, like before any junction, rather than reading as a road cut off mid-lane. A deck landing
  // within DECK_END_REACH keeps it: its lanes continue the road's. Not while enumerating decks (which
  // reads the paint it continues) nor on the raw/far paths (no decks).
  if (distanceToFreewayCenter < 99990 && laneEndGap < LANE_END_CLEAR && decksKnown && !deckEndNear(cellDecks, x, z)) distanceToFreewayCenter = 99999;

  // Step 8: tiny pieces of road a river has cut off from every other road are not drawn (not on the
  // raw/far paths: decksKnown is false there).
  if (
    decksKnown &&
    distanceToRiver < riverReach + FRAGMENT_RIVER_REACH &&
    inRoadFragment(x, z, city !== null, riverBedDistance, distanceToRoadCenter, distanceToBiomeBoundary, waterHeight > height, sdfOut, presenceOut)
  ) {
    distanceToRoadCenter = Math.max(distanceToRoadCenter, FRAGMENT_REMOVED_FIELD);
    distanceToFreewayCenter = 99999;
    riverBedDistance = Math.min(riverBedDistance, riverReach - 3);
  }

  return {
    height,
    biomeId: own.biome.id,
    regionId: own.region.id,
    blend,
    distanceToBiomeBoundaryCenter: distanceToBiomeBoundary,
    distanceToRiverCenter: distanceToRiver,
    riverBedDistance,
    underDeck,
    distanceToRoadCenter,
    distanceToFreewayCenter,
    freewayAlong,
    waterHeight,
    biomeSdf: sdfOut,
    biomePresence: presenceOut,
  };
}

// ── The public API: every other module's exports callers use ──────────────

export type {
  BiomeContext,
  BlendWidths,
  DomainConfig,
  FlattenDescriptor,
  GridCell,
  RiverParams,
  SerializedBiome,
  SerializedRegion,
  TerrainNoiseParams,
  VertexResult,
} from "./types";
export { BIOME_SDF_FAR, biomeSlotBlendHalvesOf, biomeSlotRegionsOf, biomeSlotsOf, biomeWeightOf, combineSlotWeights, getBiomeSlots } from "./zoneBlend";
export { unwarp, warp } from "./noise";
export { getBiomeGrid } from "./voronoi";
export { setDeckCutSpacing } from "./bridges/deckGround";
export { type FlattenPoint, computeVertexDataRaw, getFlattenPoints } from "./flattenPads";
export { type FreewayRun, type WallNetwork, freewayPointAt, getNetwork } from "./roads/freewayNetwork";
export { type RiverSegment, getRiverSegments, riverDebug, riverKeepOff } from "./rivers/riverNetwork";
export {
  type PlaceInfo,
  findBiomeCell,
  findRegionCell,
  getBiomeCellSite,
  getPlaceInfo,
  getRegionCellSite,
  getRegionOfCell,
  getZoneOfBiomeCell,
} from "./places";
export {
  type CityFreewaySidePoint,
  type CitySitePoint,
  type CityTrafficLightPoint,
  type RoadMarkerPoint,
  getCityFreewayEdgePoints,
  getCityFreewaySidePoints,
  getCityRoadMarkers,
  getCityTrafficLightPoints,
  getCityVoronoiSites,
  getFreewayRunMarkers,
} from "./roads/cityFeatures";
export type {
  BridgeLanePaint,
  BridgeParapetGap,
  BridgePathPoint,
  BridgePlacementParams,
  BridgeSection,
  BridgeTrimAxis,
  FreewayBridge,
  FreewayBridgePier,
  Mouth,
  RoadPath,
} from "./bridges/types";
export { BRIDGE_PARAPET_WIDTH, DEFAULT_BRIDGE_PLACEMENT } from "./bridges/constants";
export { bridgeDeckY, bridgeLaneAlong, bridgePaintAt, bridgeParapetAt, bridgeParapetLine, bridgeRampAt, bridgeSections, bridgeTrimRange } from "./bridges/deckGeometry";
export { bridgeDrawnTopAt } from "./bridges/drawnSlab";
export { bridgeDebug, getFreewayBridges, getFreewayBridgesNear } from "./bridges/freewayBridges";
export { getFreewayMouths } from "./bridges/mouths";
export { bridgeRiverCrossing } from "./bridges/rules";
