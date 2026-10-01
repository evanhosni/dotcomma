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
import { RIVER_BED_FULL_INSET } from "../../world/shaders/constants";
import { CITY_BIOME_ID } from "../../world/constants";
import { clearBridgeCaches, enumeratingBridges } from "./bridges/freewayBridges";
import { LANE_END_CLEAR, NO_DECKS, clearDeckCells, cutGroundUnderDecks, deckEndNear, deckGround, decksAround } from "./bridges/deckGround";
import { runRiverYield } from "./bridges/constants";
import { domainConfig, setDomainConfig } from "./computeConfig";
import { applyFlattenPads, computeVertexDataRaw, evaluatingPadCandidates, initFlattenPads, padsApplyIn } from "./flattenPads";
import { SHORE_RISE, clearLakeCaches, lakeLevelAt, lakeSurface, riverMouthShare, riverSurfaceBesideCrispShore, shoreLift } from "./lakes";
import { biomeNoiseHeight, terrainNoise, unwarp, warp } from "./noise";
import { initPlaces } from "./places";
import { initRivers } from "./rivers/riverNetwork";
import { capRiverBed, clearRiverField, noRiverQuay, noRiverSample, riverFieldAt, riverQuay, riverQuayAt, riverSample } from "./rivers/riverField";
import { CITY_QUAY_INNER_CAP, type CityTerrain, clearCityCaches, drownedBeltDistance, getCityTerrain, wallDrownedAt } from "./roads/cityTerrain";
import { FREEWAY_GRADE_RAMP, clearFreewayGrades, freewayGradeAt } from "./roads/freewayGrade";
import { FREEWAY_SMIN_K, type WallNetwork, clearNetworkCache, nearestFreewayRun, nearestRun, networkOf, smoothMin } from "./roads/freewayNetwork";
import { FRAGMENT_REMOVED_FIELD, FRAGMENT_RIVER_REACH, ISLAND_LAND_FIELD, TO_BANK, TO_ROAD, blockIslandAt, clearRoadFragments, islandRoad, inRoadFragment } from "./roads/roadFragments";
import type { BiomeContext, DomainConfig, RiverParams, SerializedRegion, VertexResult, Wall, Zone } from "./types";
import { clearVoronoiCaches, getBiomeContext, cityWallsOf } from "./voronoi";
import {
  ZONE_WEIGHT_EPS,
  accumulateWallFields,
  biomePresence,
  biomePresenceResult,
  biomeSdf,
  biomeSdfResult,
  combineZoneWeights,
  riverbedSdf,
  riverbedSdfAt,
  riverbedSdfResult,
  domeDepthAt,
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
/** A deck landing's approach lays its road flat this far past the freeway's half-width (real units,
 *  warped like every road distance) before its shoulder: past the deck's sides (BRIDGE_DECK_MARGIN)
 *  wherever the road warp stretches them out to ~1.4× (a ramp end measured 21 at the deck's side). */
const APPROACH_WIDEN = 8;
/** …and its shoulder meets the ground over this, gentler than a road's own FREEWAY_GRADE_RAMP: a landing's
 *  approach often stands units over a bank the river carved, and at 10u that edge measured 2–7u kinks. */
const APPROACH_SHOULDER = 30;
/** How far from a freeway centerline the normalized road distance is still written (real units). */
const FREEWAY_FIELD_REACH = 70;
/** Past the riverbed's reach a vertex still carries the bed's own texture distances this far (real
 *  units): a quad reaching into the bed interpolates them (LOD2 spacing 17.5u). */
const RIVERBED_SDF_MARGIN = 30;
/** How far past a river's footprint (real units) a vertex can still read a city wall the river drowns:
 *  the belt's field reach, plus the freeway's half-width (14) and the waterfront's fade (30, cityTerrain)
 *  a drowned wall lies within, and a margin for the meander. */
const BELT_DROWN_READ = FREEWAY_FIELD_REACH + 64;
/** A road's field is pushed off the pavement over the last this many (factor-1) units of the zone
 *  it yields to a river in: continuous, so the road ends in a clean curbed line under the deck. */
const ROAD_RIVER_RAMP = 16;
/** A city vertex on the river side of the quay reports its riverbed paint distance at most this
 *  far inside the STRAIGHT bank edge (factor-1 units): past the fade the bed shader applies, so the
 *  sand begins whole exactly where the quay's river-side sidewalk ends (see riverBedDistance). */
const QUAY_BED_INSET = RIVER_BED_FULL_INSET;
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

/** The nearest city wall — the belt seen from OUTSIDE the city: distance (the belt's: step 2 pushes it
 *  off a drowned wall), the wall's own distance, along coordinate, closest point. */
const nearestCityWall = { distance: Infinity, wall: Infinity, along: 0, x: 0, z: 0 };
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
      nearestCityWall.wall = d;
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
  if (noiseConfig) {
    const depth = noiseConfig.dome ? domeDepthAt(ctx.warped.x, ctx.warped.z, zone, noiseConfig.dome.reach, zoneMinDist[zone.index]) : 0;
    return biomeNoiseHeight(noiseConfig, x, z, depth) * presence;
  }
  if (domainConfig!.cityConfig && zone.biome.id === CITY_BIOME_ID) {
    if (!isOwn) return domainConfig!.cityConfig.maxBlockElevation * 0.5;
    if (farDry) noRiverQuay();
    else riverQuayAt(ctx.warped.x, ctx.warped.z);
    const city = getCityTerrain(x, z, domainConfig!.cityConfig, cityWallsOf(ctx), ownWallDistance, ownWallAlong, riverQuay, ctx.warped);
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

/** The zone-blended terrain at a world point (no roads, no rivers, the city at its rim grade), with
 *  the point's OWN wall pass and shore — what a road grade samples along its centerline. Clobbers the
 *  wall-pass scratch and the shore state. */
export const terrainOnlyAt = (x: number, z: number): number => {
  const warped = warp(x, z);
  const c = getBiomeContext(warped);
  accumulateWallFields(warped.x, warped.z, c.zoneWalls, c.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, c, c.zone);
  return blendedTerrainAt(x, z, c.zone, c);
};

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
  findNearestCityWall(w.x, w.z, cityWallsOf(ctx));
  return Math.min(inCity, nearestRun.distance, nearestCityWall.distance);
};

/** Set while a FAR VISUAL-ONLY terrain vertex is evaluated (computeVertexDataFar). */
let farVisual = false;
/** Set while a far vertex is evaluated WITHOUT the river field (computeVertexDataFar, rivers = false). */
let farDry = false;
const NO_RUNS: WallNetwork["freeways"] = [];

/** How far out a river's water is reported (and the bank held above it), factor-1 units: past the
 *  waterline, so the water mesh's shore triangles are level and meet the rising bank. */
const riverWaterBand = (river: RiverParams): number => river.halfWidth + river.bank * 0.5;

/** Step 4's channel at a vertex `distanceToRiver` (factor-1) from a river whose surface is
 *  `surface`: FORCED, not min'ed — a parabola from depth under the surface to a rim SHORE_RISE above
 *  it at the half-width (the water's edge sits just inside), the bank blending the rim back into the
 *  terrain, so it raises low ground as well as cutting high ground. Depth grows with the root of the
 *  width factor. */
export const carveRiverChannel = (height: number, distanceToRiver: number, surface: number, factor: number): number => {
  const river = domainConfig!.river;
  const riverReach = river.halfWidth + river.bank;
  const depth = river.depth * Math.sqrt(factor);
  const rim = surface + SHORE_RISE;
  // Ground LOWER than the rim is held at it across the whole water band and only then descends:
  // blended down from the half-width, the bank sits under the surface there and the water mesh draws
  // a second strip on the dry bank.
  return distanceToRiver < river.halfWidth
    ? rim - (depth + SHORE_RISE) * (1 - (distanceToRiver / river.halfWidth) ** 2)
    : rim + (height - rim) * smoothstep(height < rim ? riverWaterBand(river) : river.halfWidth, riverReach, distanceToRiver);
};

/** Over this far off the wall (real units) the belt's field beside a river hands over from the city's
 *  own rule to a smooth maximum that never paints the quay's bands out into the neighbor. */
const BELT_FIELD_HANDOFF = 6;
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
const offCityRoad = { height: 0, roadField: 99999, freewayField: 99999, freewayAlong: 0, laneEndGap: Infinity, approachDelta: 0 };

/** Step 5: the freeways OUTSIDE the city — the inter-city runs and the OUTER HALF of every city's belt
 *  (centered on the wall) — as one grade, one curb dip and one normalized road field, so the city road
 *  shader paints them as one surface with the city's rim. Reads step 2's nearestRun / nearestCityWall /
 *  roadReal / roadGrade and writes offCityRoad. */
const gradeOffCityFreeway = (
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
  let roadField = 99999;
  let freewayField = 99999;
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
  // interpolates it per vertex, so a 99999 beside a 9 would alias the corridor's edge into the grid.
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
    const dip = cityCfg.curbHeight * (1 - smoothstep(cityCfg.roadWidth - 2, cityCfg.roadWidth, normalized));
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
        const beltDip = cityCfg.curbHeight * (1 - smoothstep(cityCfg.roadWidth - 2, cityCfg.roadWidth, beltStraight < Infinity ? beltQuayField(normalized, nearestCityWall.wall) : normalized));
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

/** A vertex of a far visual-only terrain LOD (LOD3–5, no collider): pad-free like
 *  computeVertexDataRaw, and blind to the inter-city freeway RUNS (a 14u road cannot be resolved
 *  between such vertices; routing them was half of the startup ring's worker time). With `rivers`
 *  false (LODLevel.carvesRivers) it is blind to the river field too — no channel, water, bed paint or
 *  quay. Everything else is exact; physics, the server and the main thread never take this path, and
 *  the skirts cover the difference at the seams. */
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

  // Step 0: the decks whose ground this vertex may have to cut (step 7) — fetched FIRST: enumerating a
  // cell's decks evaluates the terrain (their landed ends), which clobbers every scratch buffer below.
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
  const offCity = own.biome.id !== CITY_BIOME_ID;
  if (offCity) findNearestCityWall(cvx, cvz, cityWallsOf(ctx));
  if (farDry) noRiverSample();
  // In a city (and just outside its wall) the quay rule paints the bed a little past the field's
  // reach: the bed limit is wanted there too.
  else riverFieldAt(cvx, cvz, !offCity || nearestCityWall.wall < BELT_FIELD_HANDOFF);
  const distanceToRiver = riverSample.distance;
  const riverFactor = riverSample.factor;
  const fw = domainConfig.cityConfig.freewayWidth;
  let roadReal = Infinity;
  let roadGrade = NaN;
  // Off the city: whether riverQuay holds this vertex's straight river field (step 2 measured it).
  let quayBeside = false;
  if (offCity) {
    // Runs never enter a water zone (the network forbids water walls); the belt's outer half DOES
    // ride over a lake neighbor, as a causeway on the city's grade above the water.
    if (own.biome.water) nearestRun.distance = Infinity;
    else nearestFreewayRun(cvx, cvz, farVisual ? NO_RUNS : networkOf(ctx).freeways);
    // The belt as the city's own side measures it: off a wall the river drowns it is pushed away (the
    // waterfront carries it), so its outer half is never graded and dipped where the inner half is not.
    if (!farDry && nearestCityWall.distance < FREEWAY_FIELD_REACH && (distanceToRiver - river.halfWidth - river.bank) * riverFactor < BELT_DROWN_READ) {
      riverQuayAt(cvx, cvz);
      quayBeside = riverQuay.distance < Infinity;
      const belt = drownedBeltDistance(cvx, cvz, cityWallsOf(ctx), nearestCityWall.distance, riverQuay);
      if (belt > nearestCityWall.distance + 1e-9) nearestCityWall.distance = belt;
    }
    // Smooth minimum: a run meets the belt with a filleted mouth instead of a sharp inside corner.
    roadReal = smoothMin(nearestCityWall.distance, nearestRun.distance, FREEWAY_SMIN_K);
    // Wider beside a deck (step 7's approach) and wherever decks are being built (their landings).
    const gradeReach = cellDecks.length > 0 || enumeratingBridges > 0 ? fw + APPROACH_WIDEN + APPROACH_SHOULDER : fw + FREEWAY_GRADE_RAMP;
    if (roadReal < gradeReach) roadGrade = freewayGradeAt(cvx, cvz, x, z, ctx, !farVisual);
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
  // The riverbed PAINT distance. In a city the quay decides where the sand begins (right past its
  // river-side sidewalk), so a city vertex reports at most the STRAIGHT distance less QUAY_BED_INSET:
  // by the meandered distance alone, plaza concrete shows between sidewalk and sand wherever the
  // channel wanders away. Never below where the bed is whole: further in it is the river's own
  // distance, as across the city's wall (the bed darkens toward the channel by it — 17u apart there).
  let riverBedDistance = distanceToRiver;
  if (city !== null && riverQuay.distance < Infinity) {
    const quayBed = Math.max(riverQuay.distance / riverQuay.factor - QUAY_BED_INSET, river.halfWidth + river.bank - RIVER_BED_FULL_INSET);
    riverBedDistance = Math.min(distanceToRiver, quayBed);
  } else if (quayBeside && nearestCityWall.wall < BELT_FIELD_HANDOFF) {
    // Just outside the wall the same rule hands over to the river's own distance, so the sand does
    // not start on a line along the wall (9u of bed distance apart, beside a river leaving a city).
    const quayBed = Math.max(riverQuay.distance / riverQuay.factor - QUAY_BED_INSET, river.halfWidth + river.bank - RIVER_BED_FULL_INSET);
    riverBedDistance = Math.min(distanceToRiver, quayBed + (distanceToRiver - quayBed) * smoothstep(0, BELT_FIELD_HANDOFF, nearestCityWall.wall));
  }
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

  // Step 4: water — a lake's level and the shore lift, then a river channel. NaN where no water is
  // in reach (the water mesh dives under the ground).
  let waterHeight = lakeSurface(currentVertex, ctx, own);
  const lakeLevel = waterHeight;
  if (city !== null && city.curbDip > 0) {
    // The city's curb dips UNDER a shore lift, as the belt's outer half dips under its lifted grade
    // (step 5): lifted with it, the road stood level with the lake side's curb 0.3u below it.
    const dip = blend * city.curbDip;
    const lifted = shoreLift(height + dip);
    if (lifted !== height + dip) height = lifted - dip;
  } else height = shoreLift(height);
  const riverReach = river.halfWidth + river.bank;
  const waterBand = riverWaterBand(river);
  const riverSurface = distanceToRiver < riverReach ? riverSurfaceBesideCrispShore(riverSample.surface) : NaN;
  // The bed ends where its bank first gets too steep going outward, never to resume beyond — wherever
  // the paint reaches. Not in a city: past the city's edge roads its ground is the bank, and capped,
  // its plaza showed as grey tongues on the sand; its pavement keeps the bed off by itself (the shader's
  // pavement mask). Capped only inside the river's footprint, the paint's edge stepped along that line.
  if (riverBedDistance < riverReach && city === null) riverBedDistance = capRiverBed(riverBedDistance, riverSample.bedLimit);
  let mouth = 0;
  if (!Number.isNaN(riverSurface)) {
    // A river MOUTH (riverMouthShare): over the lakebed the channel only deepens the ground and the
    // water is the lake's — no bank rim, no surface above the lake's, no bed paint across the mouth.
    mouth = riverMouthShare(height, waterHeight);
    const carved = carveRiverChannel(height, distanceToRiver, riverSurface, riverSample.factor);
    let surface = riverSurface;
    if (mouth > 0) {
      height = carved + (Math.min(carved, height) - carved) * mouth;
      if (surface > waterHeight) surface += (waterHeight - surface) * mouth;
      riverBedDistance += (Math.max(riverBedDistance, riverReach) - riverBedDistance) * mouth;
    } else height = carved;
    if (distanceToRiver < waterBand) waterHeight = Number.isNaN(waterHeight) ? surface : Math.max(waterHeight, surface);
  }
  // 1 on open ground, 0 in the channel. The city's arterials and belt cross the river on decks: no
  // lane paint on the riverbed.
  const channel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, riverReach, distanceToRiver);
  if (city !== null && channel < 0.999) distanceToFreewayCenter = 99999;

  // Step 5: freeways OUTSIDE the city (step 2 found them).
  let approachDelta = 0;
  let approachRimLift = 0;
  if (city === null) {
    gradeOffCityFreeway(height, cvx, cvz, own, ctx, roadReal, roadGrade, distanceToRiver, riverFactor, riverSurface, lakeLevel);
    height = offCityRoad.height;
    distanceToRoadCenter = offCityRoad.roadField;
    distanceToFreewayCenter = offCityRoad.freewayField;
    freewayAlong = offCityRoad.freewayAlong;
    laneEndGap = offCityRoad.laneEndGap;
    approachDelta = offCityRoad.approachDelta;
    // Where that road lies under the river's rim the bank holds it up as it holds any low ground
    // (carveRiverChannel) — under the deck only (step 7), or a cut's end sits on a bowed road again.
    if (approachDelta !== 0 && !Number.isNaN(riverSurface) && mouth === 0) {
      const approach = height + approachDelta;
      approachRimLift = Math.max(0, carveRiverChannel(approach, distanceToRiver, riverSurface, riverFactor) - approach);
    }
  }

  // Step 6: flatten pads — not while evaluating pad candidates (they are defined against the RAW
  // terrain), and only in biomes some flatten descriptor targets. Pads RECURSE into the pipeline and
  // clobber every scratch buffer: everything returned was captured above, and the per-slot buffers
  // are copied into the result buffers the recursion (raw, returning the scratch itself) never writes.
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
  const approachHeight = height + approachDelta;
  let underDeck = 0;
  if (cellDecks.length > 0) {
    deckGround.height = height;
    deckGround.roadField = distanceToRoadCenter;
    deckGround.freewayField = distanceToFreewayCenter;
    deckGround.waterHeight = waterHeight;
    deckGround.approachDelta = approachDelta;
    deckGround.approachRimLift = approachRimLift;
    cutGroundUnderDecks(cellDecks, x, z, city !== null, distanceToRiver);
    height = deckGround.height;
    distanceToRoadCenter = deckGround.roadField;
    distanceToFreewayCenter = deckGround.freewayField;
    waterHeight = deckGround.waterHeight;
    underDeck = deckGround.underDeck;
  }

  // Step 7b: a freeway that reaches a river with no deck to carry it on ENDS: its lane paint (and the
  // median markers, which follow it) stops LANE_END_CLEAR short of the quay or bank, as before any
  // junction. A deck landing nearby (deckEndNear) continues the lanes. Not while enumerating decks
  // (which reads the paint it continues) nor on the raw/far paths (no decks).
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
    riverBedDistance = Math.min(riverBedDistance, riverReach - RIVER_BED_FULL_INSET);
  }
  // Step 8b: block islands — city land no building could stand on, too small to be a block, goes the
  // way most of its rim does: road (the field reflected about the foot of the curb's dip ramp, so it
  // meets the road around it, at the road's own height there), or the river's bank like a fragment.
  const island = decksKnown && city !== null && city.nearEdge ? blockIslandAt(x, z, riverBedDistance, distanceToRoadCenter, waterHeight > height, sdfOut, presenceOut) : 0;
  if (island === TO_ROAD) {
    if (!Number.isNaN(islandRoad.height)) height = islandRoad.height;
    distanceToRoadCenter = Math.max(0, 2 * ISLAND_LAND_FIELD - distanceToRoadCenter);
  } else if (island === TO_BANK) {
    distanceToRoadCenter = Math.max(distanceToRoadCenter, FRAGMENT_REMOVED_FIELD);
    riverBedDistance = Math.min(riverBedDistance, riverReach - RIVER_BED_FULL_INSET);
  }

  // The riverbed's texture distances, from the vertex's own (sdfOut, restored around every step that
  // clobbers it): the last step, so nothing overwrites them after. Away from any bed they are the
  // ground's (the shader reads them only where the bed shows; the margin covers a LOD2 quad).
  const bedSdfOut = evaluatingPadCandidates ? riverbedSdf : riverbedSdfResult;
  if ((riverBedDistance - riverReach) * riverFactor < RIVERBED_SDF_MARGIN) riverbedSdfAt(cvx, cvz, ctx.zoneWalls, own, sdfOut, bedSdfOut);
  else bedSdfOut.set(sdfOut);

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
    approachHeight,
    biomeSdf: sdfOut,
    biomePresence: presenceOut,
    riverbedSdf: bedSdfOut,
  };
}

// ── The public API: every other module's exports callers use ──────────────

export type {
  BiomeContext,
  BiomeDomeConfig,
  BiomeNoiseConfig,
  DomainConfig,
  FlattenDescriptor,
  GridCell,
  SerializedBiome,
  SerializedRegion,
  TerrainNoiseParams,
  VertexResult,
} from "./types";
export { BIOME_SDF_FAR, riverbedSlotHalvesOf, biomeSlotBlendHalvesOf, biomeSlotRegionsOf, biomeSlotsOf, biomeWeightOf, combineSlotWeights, getBiomeSlots } from "./zoneBlend";
export { unwarp, warp } from "./noise";
export { setDeckCutSpacing } from "./bridges/deckGround";
export { type FlattenPoint, computeVertexDataRaw, getFlattenPoints } from "./flattenPads";
export { freewayPointAt, getNetwork } from "./roads/freewayNetwork";
export { getRiverSegments, riverDebug, riverKeepOff } from "./rivers/riverNetwork";
export { type PlaceInfo, findBiomeCell, findRegionCell, getBiomeCellSite, getPlaceInfo, getRegionCellSite, getZoneOfBiomeCell } from "./places";
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
export { type FreewayLampParams, type FreewayLampPoint, getFreewayRunLamps, runLampDebug } from "./roads/runLamps";
export type { BridgePlacementParams, BridgeSection, FreewayBridge } from "./bridges/types";
export { BRIDGE_PARAPET_WIDTH, DEFAULT_BRIDGE_PLACEMENT } from "./bridges/constants";
export { bridgeDeckY, bridgeLaneAlong, bridgePaintAt, bridgeParapetAt, bridgeParapetLine, bridgeSections, bridgeTrimRange } from "./bridges/deckGeometry";
export { bridgeDrawnTopAt } from "./bridges/drawnSlab";
export { bridgeDebug, getFreewayBridges } from "./bridges/freewayBridges";
export { getFreewayMouths } from "./bridges/mouths";
export { bridgeRiverCrossing } from "./bridges/rules";
