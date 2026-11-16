/**
 * THE height pipeline (CLAUDE.md: "Heights have a single source of truth"): one vertex evaluation
 * (computeVertexData) over the modules beside this file — noise, the voronoi grids, the zone wall
 * pass, lakes, flatten pads, and the rivers/, roads/, bridges/ and underground/ folders — run
 * identically by every worker, the main thread and the server. Three-free.
 *
 * This file is also the pipeline's PUBLIC API: every caller outside utils/workers/ imports from here
 * (the re-exports at the bottom), never from the modules themselves.
 *
 * The modules import each other in CYCLES (a river surface samples the terrain, the terrain samples
 * the rivers), which ES modules, esbuild and babel-jest all resolve — as long as no module USES
 * another pipeline module's export at its own top level (a constant derived from one would read it
 * before it is initialized). Values cross modules only inside functions.
 */

import { smoothMin, smoothstep } from "../math";
import { RIVER_BED_FULL_INSET } from "../../world/shaders/constants";
import { CITY_BIOME_ID } from "../../world/constants";
import { roadBearingBiomeIds } from "./biomeFlags";
import { clearBridgeCaches, enumeratingBridges } from "./bridges/freewayBridges";
import { LANE_END_CLEAR, NO_DECKS, clearDeckCells, cutGroundUnderDecks, deckEndNear, deckGround, decksAround } from "./bridges/deckGround";
import { domainConfig, setDomainConfig } from "./computeConfig";
import { applyFlattenPads, computeVertexDataRaw, evaluatingPadCandidates, initFlattenPads, padsApplyIn } from "./flattenPads";
import { clearLakeCaches, lakeBedBumps, lakeBowlHeight, lakeLevelAt, lakeSurface, shoreLift } from "./water/lakes";
import { keepsOwnBanks } from "./water/params";
import { resolveWater, water } from "./water";
import { clearPonds } from "./water/ponds";
import { clearJoins } from "./water/joins";
import { biomeNoiseHeight, terrainNoise, warp } from "./noise";
import { initPlaces } from "./places";
import { carveRiverChannel, clearChannel } from "./water/channel";
import { clearRiverField, farRiverFieldAt, noRiverQuay, riverFieldAt, riverQuay, riverQuayAt, riverSample } from "./water/rivers/field";
import { riverKeepOff } from "./water/rivers/constants";
import { initRivers } from "./water/rivers/network";
import { NO_ROAD_DISTANCE } from "./roads/cityRoadField";
import { type CityTerrain, clearCityCaches, getCityTerrain } from "./roads/cityTerrain";
import { drownedBeltDistance } from "./roads/cityWaterfront";
import {
  APPROACH_SHOULDER,
  APPROACH_WIDEN,
  BELT_DROWN_READ,
  BELT_FIELD_HANDOFF,
  FREEWAY_FIELD_REACH,
  FREEWAY_MERGE_CLEAR,
  findNearestCityWall,
  gradeOffCityFreeway,
  nearestCityWall,
  offCityRoad,
} from "./roads/offCityFreeway";
import { FREEWAY_GRADE_RAMP, clearFreewayGrades, freewayGradeAt } from "./roads/freewayGrade";
import { FREEWAY_SMIN_K, type WallNetwork, clearNetworkCache, nearestFreewayRun, nearestRun, networkOf } from "./roads/freewayNetwork";
import { FRAGMENT_REMOVED_FIELD, FRAGMENT_RIVER_REACH, ISLAND_LAND_FIELD, TO_BANK, TO_ROAD, blockIslandAt, clearRoadFragments, islandRoad, inRoadFragment } from "./roads/roadFragments";
import { clearSnowCaches, snowMovementAt } from "./snow/snowDrift";
import { createMovementModifiers, resetMovementModifiers, type MovementModifiers } from "../../physics/movementModifiers";
import { clearMouthTiles, mouthBulgeAt, mouthsNear, NO_MOUTHS } from "./underground/mouthBulge";
import { clearSewerGeometry } from "./underground/sewerMesh";
import { clearSewerLayouts } from "./underground/sewers";
import { clearTunnelCaches, generatingTunnels } from "./underground/systems";
import type { BiomeContext, DomainConfig, SerializedRegion, VertexResult, Zone } from "./types";
import { clearVoronoiCaches, getBiomeContext, cityWallsOf, distanceToWall } from "./voronoi";
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
  ownReliefDist,
  ownWallDistance,
  sstep01,
  zoneFinal,
  zoneMinDist,
  zoneWeights,
  zones,
} from "./zoneBlend";
import { isLakeBiome, lakeOf } from "./water/lakes/params";
import { clearValleys, valleyHeightAt } from "./water/valleys";

/** Past the riverbed's reach a vertex still carries the bed's own texture distances this far (real
 *  units): a quad reaching into the bed interpolates them (LOD2 spacing 17.5u). */
const RIVERBED_SDF_MARGIN = 30;
/** The bed paint distance the QUAY gives the vertex riverQuayAt last measured (factor-1 units): its
 *  STRAIGHT distance less the paint's full inset, so the sand begins whole right past the quay's
 *  river-side sidewalk — a band of constant width, where the meandered distance left plaza concrete
 *  between sidewalk and sand wherever the channel wandered off — never below where the bed is whole. */
const quayBedDistance = (): number => Math.max(riverQuay.distance / riverQuay.factor, riverKeepOff()) - RIVER_BED_FULL_INSET;

export function initCompute(config: DomainConfig): void {
  setDomainConfig(config);
  // Everything keyed by seed or by config-derived objects is stale across an init.
  clearVoronoiCaches();
  clearCityCaches();
  clearLakeCaches();
  clearNetworkCache();
  clearFreewayGrades();
  clearRiverField();
  clearPonds();
  clearJoins();
  clearChannel();
  clearDeckCells();
  clearRoadFragments();
  clearBridgeCaches();
  clearTunnelCaches();
  clearMouthTiles();
  clearSewerLayouts();
  clearSewerGeometry();
  clearSnowCaches();
  clearValleys();
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

/** The own zone's city terrain, when zoneBiomeHeight evaluated one for the current vertex. */
let ownCityTerrain: CityTerrain | null = null;

/** A zone's BIOME height at (x, z) (the region base is added by the caller), already scaled by the
 *  biome's PRESENCE: 0 at the biome's own edge (the region base
 *  shows), 1 one height-blend width inside; a crisp biome (city) has presence 1 everywhere, so
 *  evaluated OUTSIDE its zone it continues at the belt freeway's grade — the value its
 *  own rim already holds at the wall (getCityTerrain) — and the neighbor's ramp starts
 *  on the road surface. Water biomes bowl `depth` below the base. A zone in the own zone's RELIEF JOIN
 *  (zoneBlend.ts joinReliefs) is present as the join is: by the join's outer walls, not its own. */
const zoneBiomeHeight = (zone: Zone, x: number, z: number, own: Zone, ctx: BiomeContext): number => {
  const isOwn = zone === own;
  const joined = zone.reliefGroup >= 0 && zone.reliefGroup === own.reliefGroup;
  const presence = zone.crisp ? 1 : joined ? sstep01(ownReliefDist / zone.heightPresenceWidth) : isOwn ? sstep01(zoneMinDist[zone.index] / zone.heightPresenceWidth) : 0;
  const lake = lakeOf(zone.biome);
  if (lake) {
    // Relative to the LEVEL, not the base: the shore (presence 0, both sides of the wall)
    // stands SHORE_RISE above the water and the bowl descends to depth below it.
    const level = lakeLevelAt(ctx.warped, ctx.grid);
    if (Number.isNaN(level)) return -lake.depth * presence + lakeBedBumps(ctx.warped, presence, lake);
    return lakeBowlHeight(level, lake, presence, ctx.warped) - terrainNoise(zone.baseNoise, x, z);
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

/** The zone-weighted terrain (region bases + presence-scaled biome heights) at a point, using the
 *  CURRENT vertex's weights and presences, the city at `cityHeight` (the exact plateau needs its own
 *  wall pass), risen away from water (`valleys`; never for the water's own probes, which read it at the
 *  water's edge, where it is 0, and build what it is measured from), lifted with a lake's shore. */
const blendTerrain = (x: number, z: number, own: Zone, ctx: BiomeContext, cityHeight: (zone: Zone) => number, valleys: boolean): number => {
  let h = 0;
  if (valleys) {
    const w = warp(x, z);
    h = valleyHeightAt(w.x, w.z, farDry ? Infinity : undefined);
  }
  for (let i = 0; i < zones.length; i++) {
    const w = zoneFinal[i];
    if (w < ZONE_WEIGHT_EPS) continue;
    const zone = zones[i];
    const biomeHeight = zone.biome.id === CITY_BIOME_ID ? cityHeight(zone) : zoneBiomeHeight(zone, x, z, own, ctx);
    h += w * (terrainNoise(zone.baseNoise, x, z) + biomeHeight);
  }
  return shoreLift(h);
};
const cityRimGrade = (): number => domainConfig!.cityConfig.maxBlockElevation * 0.5;
/** The terrain a road grade samples at its centerline without a second wall pass: the city at its rim
 *  grade, seen from a road. */
export const blendedTerrainAt = (x: number, z: number, own: Zone, ctx: BiomeContext, valleys = true): number => blendTerrain(x, z, own, ctx, cityRimGrade, valleys);
/** The terrain a water surface hangs from (water/utils.ts waterGroundAt): as blendedTerrainAt, but a biome that keeps
 *  its own banks (<Quays/>) at its plateau FLOOR, so no block can sit under the water. */
export const waterTerrainAt = (x: number, z: number, own: Zone, ctx: BiomeContext): number =>
  blendTerrain(x, z, own, ctx, (zone) => (keepsOwnBanks(zone.biome) ? 0 : cityRimGrade()), false);

/** The zone-blended terrain at a world point (no roads, no rivers, the city at its rim grade), with
 *  the point's OWN wall pass and shore — what a road grade samples along its centerline. Clobbers the
 *  wall-pass scratch and the shore state. */
export const terrainOnlyAt = (x: number, z: number, valleys = true): number => {
  const warped = warp(x, z);
  const c = getBiomeContext(warped);
  accumulateWallFields(warped.x, warped.z, c.zoneWalls, c.zone);
  combineZoneWeights(zoneWeights, zoneFinal);
  lakeSurface(warped, c, c.zone);
  return blendedTerrainAt(x, z, c.zone, c, valleys);
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

/** Whether a world point lies outside every one of `biomeIds` (none = every biome) — exactly the
 *  biomeId test of passesPlacementFilters, from the point's own zone alone: a placement checks it
 *  before paying for the whole vertex (most of a city descriptor's rolls fall outside the city). */
export const outsideBiomes = (biomeIds: readonly number[] | undefined, x: number, z: number): boolean =>
  !!biomeIds && biomeIds.length > 0 && !biomeIds.includes(getBiomeContext(warp(x, z)).zone.biome.id);

/** Set while a FAR VISUAL-ONLY terrain vertex is evaluated (computeVertexDataFar). */
let farVisual = false;
/** Set while a far vertex is evaluated on the coarse FAR river field (computeVertexDataFar, rivers = false). */
let farDry = false;
const NO_RUNS: WallNetwork["freeways"] = [];

/** A vertex of a far visual-only terrain LOD (LOD3–4, no collider): pad-free like
 *  computeVertexDataRaw, and blind to the inter-city freeway RUNS (a 14u road cannot be resolved
 *  between such vertices; routing them was half of the startup ring's worker time). With `rivers`
 *  false (LODLevel.carvesRivers) it reads the coarse far field instead (rivers/field.ts farRiverFieldAt:
 *  the walls and the valleys' gap) — no channel, water, bed paint or quay. Everything else is exact; physics, the server and the main thread never take this path, and
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

/** A whole vertex of the pad-free pipeline, as near terrain draws it whatever is evaluating now: the
 *  ground a river bed limit's march reads (rivers/bedLimit.ts), the same from any caller. */
export const bankGroundAt = (x: number, z: number): VertexResult => {
  const visual = farVisual;
  const dry = farDry;
  farVisual = false;
  farDry = false;
  try {
    return computeVertexDataRaw(x, z);
  } finally {
    farVisual = visual;
    farDry = dry;
  }
};

/** Set while the ground under a road is probed (groundUnderRoadAt): the pipeline sees no inter-city run. */
let probingGround = 0;

/** The ground a run's grade rides at a world point (roads/freewayGrade.ts): the pad-free terrain as it is
 *  drawn — valleys, river walls and all — with no inter-city run on it, or NaN where a river or pond
 *  holds it (its channel, its banks, any water: a deck carries the road there). Evaluates whole terrain
 *  points: only from step 0 of a vertex, or outside the pipeline. */
export const groundUnderRoadAt = (x: number, z: number): number => {
  const visual = farVisual;
  const dry = farDry;
  farVisual = false;
  farDry = false;
  probingGround++;
  try {
    const v = computeVertexDataRaw(x, z);
    const rv = domainConfig!.river;
    return v.waterDepth > 0 || v.distanceToRiverCenter < rv.halfWidth + rv.bank + GROUND_RIVER_MARGIN ? NaN : v.height;
  } finally {
    probingGround--;
    farVisual = visual;
    farDry = dry;
  }
};
/** Past a river's footprint by this much (factor-1 units) its channel no longer pulls the ground down. */
const GROUND_RIVER_MARGIN = 4;

/** The grade of the inter-city run(s) near a world point, or NaN with none within reach of a deck's approach
 *  (a superset of where step 2 grades a road: the belt's drowned push only widens its distance, a smooth
 *  minimum lowers it by under FREEWAY_SMIN_K). */
const runQuery = { distance: Infinity, along: 0, x: 0, z: 0 };
const runGradeNear = (x: number, z: number): number => {
  const w = warp(x, z);
  const c = getBiomeContext(w);
  if (roadBearingBiomeIds().includes(c.zone.biome.id) || isLakeBiome(c.zone.biome)) return NaN;
  nearestFreewayRun(w.x, w.z, networkOf(c).freeways, runQuery);
  const fw = domainConfig!.cityConfig.freewayWidth;
  if (!(runQuery.distance < fw + APPROACH_WIDEN + APPROACH_SHOULDER + FREEWAY_SMIN_K)) return NaN;
  return freewayGradeAt(w.x, w.z, x, z, c, true);
};

/** One vertex of the full pipeline. `cutDecks` false (a terrain LOD whose LODLevel.cutsDecks is false)
 *  leaves out step 7, the ground under the decks, and with it the cell's deck enumeration; the
 *  lane-end, fragment and island steps run as everywhere a cell has no deck. */
export function computeVertexData(x: number, z: number, cutDecks = true): VertexResult {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const river = domainConfig.river;

  // Step 0: the decks whose ground this vertex may have to cut (step 7), and the cave mouths whose
  // bulge it may take (step 6) — fetched FIRST: enumerating a cell's decks or generating a cave
  // evaluates the terrain, which clobbers every scratch buffer below. The raw path (pad candidates,
  // far LODs) and a vertex read during cave generation see no bulge, so no mouth depends on its own.
  const decksKnown = !evaluatingPadCandidates && enumeratingBridges === 0;
  const cellDecks = decksKnown && cutDecks ? decksAround(x, z) : NO_DECKS;
  const tunnelsKnown = decksKnown && generatingTunnels === 0;
  const mouths = tunnelsKnown ? mouthsNear(x, z) : NO_MOUTHS;
  // …and the grade of an inter-city run in reach: its profile probes the road-free ground along the run.
  const runGrade = probingGround === 0 && !farVisual ? runGradeNear(x, z) : NaN;

  // Step 1: the road-noise warp — every grid, wall, road and river lives in warped space.
  const currentVertex = warp(x, z);
  const cvx = currentVertex.x;
  const cvz = currentVertex.z;

  // Step 2: the biome cell (its zone carries the region), then everything that CLOBBERS the wall-pass
  // scratch, then the vertex's ONE wall pass. The river field comes first (building a cell's river
  // list evaluates the terrain at river centerlines); off a road-bearing biome (whose height code lays
  // its own roads), the nearest freeway (runs + the belt's outer half) and — only where step 5 will use
  // it — its grade at the centerline.
  const ctx = getBiomeContext(currentVertex);
  const own = ctx.zone;
  const ownRoads = roadBearingBiomeIds().includes(own.biome.id);
  const ownQuays = keepsOwnBanks(own.biome);
  // The river field before anything else: a cold tile list, or a bed limit's march, evaluates whole
  // terrain points (a biome that keeps its own banks paints its own bed edge: no bed limit there). Step 4
  // reads the limit only inside the river's reach — or, off such a biome, inside the quay's read beside
  // the city's wall, where the quay can pull the bed distance under the river's (quayBeside below).
  if (farDry) farRiverFieldAt(cvx, cvz);
  else riverFieldAt(cvx, cvz, ownQuays, true, !ownQuays && distanceToWall(cvx, cvz, cityWallsOf(ctx)) < FREEWAY_FIELD_REACH + 1 ? BELT_DROWN_READ : 0);
  const distanceToRiver = riverSample.distance;
  const riverFactor = riverSample.factor;
  const discDepth = riverSample.depth;
  const pondBody = riverSample.pondBody;
  const pondShare = riverSample.pondShare;
  const riverWallList = riverSample.walls;
  // Step 3's valleys, off the field's distance (a far dry LOD's: the far field's).
  const valley = valleyHeightAt(cvx, cvz, riverSample.gap);
  if (!ownRoads) findNearestCityWall(cvx, cvz, cityWallsOf(ctx));
  // The city's own wall, before a drowned belt is pushed off it (step 4's merge keeps clear of the city).
  const cityWallAway = ownRoads ? 0 : nearestCityWall.distance;
  const fw = domainConfig.cityConfig.freewayWidth;
  let roadReal = Infinity;
  let roadGrade = NaN;
  // Off a biome keeping its own banks: whether the city's quay holds this vertex's straight river field.
  let quayBeside = false;
  if (!ownRoads) {
    // Runs never enter a water zone (the network forbids water walls); the belt's outer half DOES
    // ride over a lake neighbor, as a causeway on the city's grade above the water.
    if (isLakeBiome(own.biome)) nearestRun.distance = Infinity;
    else nearestFreewayRun(cvx, cvz, farVisual || probingGround > 0 ? NO_RUNS : networkOf(ctx).freeways);
    // The belt as the city's own side measures it: off a wall the river drowns it is pushed away (the
    // waterfront carries it), so its outer half is never graded and dipped where the inner half is not.
    if (!ownQuays && !farDry && nearestCityWall.distance < FREEWAY_FIELD_REACH && (distanceToRiver - river.halfWidth - river.bank) * riverFactor < BELT_DROWN_READ) {
      riverQuayAt(cvx, cvz);
      quayBeside = riverQuay.distance < Infinity;
      const belt = drownedBeltDistance(cvx, cvz, cityWallsOf(ctx), nearestCityWall.distance, riverQuay);
      if (belt > nearestCityWall.distance + 1e-9) nearestCityWall.distance = belt;
    }
    // Smooth minimum: a run meets the belt with a filleted mouth instead of a sharp inside corner.
    roadReal = smoothMin(nearestCityWall.distance, nearestRun.distance, FREEWAY_SMIN_K);
    // Wider beside a deck (step 7's approach) and wherever decks are being built (their landings).
    const gradeReach = cellDecks.length > 0 || enumeratingBridges > 0 ? fw + APPROACH_WIDEN + APPROACH_SHOULDER : fw + FREEWAY_GRADE_RAMP;
    // (Step 0 graded a run in reach; with none, the belt alone is graded here — it probes nothing.)
    if (roadReal < gradeReach) roadGrade = Number.isNaN(runGrade) ? freewayGradeAt(cvx, cvz, x, z, ctx, false) : runGrade;
  }
  accumulateWallFields(cvx, cvz, ctx.zoneWalls, own);
  const distanceToBiomeBoundary = ownWallDistance;

  // Step 3: Heights — every zone in reach, weighted by crispness precedence; each zone
  // rides ITS region's base noise, its biome height scaled by its presence — on the valleys' additional
  // height (water/valleys: 0 at the water, whole a blend away).
  combineZoneWeights(zoneWeights, zoneFinal);
  const blend = zoneFinal[own.index];
  let height = valley;
  let distanceToRoadCenter = NO_ROAD_DISTANCE; // normalized street units; set by the city field or step 5
  let distanceToFreewayCenter = NO_ROAD_DISTANCE;
  let freewayAlong = 0;
  ownCityTerrain = null;
  for (let i = 0; i < zones.length; i++) {
    const w = zoneFinal[i];
    if (w < ZONE_WEIGHT_EPS) continue;
    const zone = zones[i];
    height += w * (terrainNoise(zone.baseNoise, x, z) + zoneBiomeHeight(zone, x, z, own, ctx));
  }
  const city = ownCityTerrain as CityTerrain | null;
  // The riverbed PAINT distance: the river's own, except where the city's quay decides where its sand
  // begins (quayBedDistance) — in the city, and handing over to the river's own just outside its wall,
  // so the sand does not start on a line along the wall.
  let riverBedDistance = distanceToRiver;
  const quayShare = city !== null && riverQuay.distance < Infinity ? 1 : quayBeside ? 1 - smoothstep(0, BELT_FIELD_HANDOFF, nearestCityWall.wall) : 0;
  if (quayShare > 0) riverBedDistance = Math.min(distanceToRiver, distanceToRiver + (quayBedDistance() - distanceToRiver) * quayShare);
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
      if (nearestRun.distance < fw + FREEWAY_MERGE_CLEAR) distanceToFreewayCenter = NO_ROAD_DISTANCE;
    }
  }

  // Step 4: water (water/index.ts) — a lake's level and the shore lift, the river channel, and the joins
  // between them.
  resolveWater({
    x,
    z,
    height,
    riverBedDistance,
    distance: distanceToRiver,
    factor: riverFactor,
    walls: riverWallList,
    discDepth,
    pondBody,
    pondShare,
    biome: ctx,
    ownBanksWeight: ownQuays ? blend : 0,
    riverBanksShare: quayBeside ? smoothstep(0, BELT_FIELD_HANDOFF, nearestCityWall.wall) : 1,
    streetCurbDip: city !== null ? blend * city.curbDip : 0,
    freewayDistance: Math.min(Number.isNaN(roadReal) ? Infinity : roadReal, cityWallAway),
    beltDistance: cityWallAway,
  });
  height = water.height;
  riverBedDistance = water.riverBedDistance;
  let waterHeight = water.waterHeight;
  // (Captured: the pads below recurse into the pipeline and overwrite `water`.)
  const { lakeLevel, riverSurface, mouth, flowX: waterFlowX, flowZ: waterFlowZ, body: waterBody, bodyShare: waterBodyShare, body2: waterBody2, bank, channelDepth } = water;
  const riverReach = river.halfWidth + river.bank;
  // The city's freeways cross the river on decks: no lane paint in the channel.
  if (city !== null && water.channel < 0.999) distanceToFreewayCenter = NO_ROAD_DISTANCE;

  // Step 5: freeways OUTSIDE the city (step 2 found them).
  let approachDelta = 0;
  let approachRimLift = 0;
  if (city === null) {
    gradeOffCityFreeway(height, cvx, cvz, own, ctx, roadReal, roadGrade, distanceToRiver, riverFactor, riverSurface, lakeLevel, bank, channelDepth);
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
      approachRimLift = Math.max(0, carveRiverChannel(approach, distanceToRiver, riverSurface, riverFactor, bank, channelDepth) - approach);
    }
  }

  // Step 6: the cave mouths' bulge (underground/mouthBulge.ts) — the one height step the tunnels
  // make, zero on roads, rivers and water — then the flatten pads, which still override it. Pads are
  // not applied while evaluating pad candidates (they are defined against the RAW terrain), and only
  // in biomes some flatten descriptor targets. Pads RECURSE into the pipeline and clobber every scratch
  // buffer: everything returned was captured above, and the per-slot buffers are copied into the
  // result buffers the recursion (raw, returning the scratch itself) never writes.
  if (mouths.length > 0) height = mouthBulgeAt(mouths, x, z, height, { waterHeight, distanceToRoadCenter, distanceToFreewayCenter, distanceToRiverCenter: distanceToRiver });
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
  if (distanceToFreewayCenter < NO_ROAD_DISTANCE && laneEndGap < LANE_END_CLEAR && decksKnown && !deckEndNear(cellDecks, x, z)) distanceToFreewayCenter = NO_ROAD_DISTANCE;

  // Step 8: tiny pieces of road a river has cut off from every other road are not drawn (not on the
  // raw/far paths: decksKnown is false there).
  if (
    decksKnown &&
    distanceToRiver < riverReach + FRAGMENT_RIVER_REACH &&
    // (A sliver thinner than the lattice goes too, but not at a deck's mouth: its asphalt is the deck's.)
    inRoadFragment(x, z, city !== null, riverBedDistance, distanceToRoadCenter, distanceToBiomeBoundary, waterHeight > height, sdfOut, presenceOut, !deckEndNear(cellDecks, x, z))
  ) {
    distanceToRoadCenter = Math.max(distanceToRoadCenter, FRAGMENT_REMOVED_FIELD);
    distanceToFreewayCenter = NO_ROAD_DISTANCE;
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

  // Step 8: the water sheet's depth.
  const waterDepth = Number.isNaN(waterHeight) || waterHeight <= height ? 0 : waterHeight - height;

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
    waterDepth,
    waterFlowX,
    waterFlowZ,
    waterBody,
    waterBodyShare,
    waterBody2,
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
export { getRiverSegments } from "./water/rivers/network";
export { riverKeepOff } from "./water/rivers/constants";
export { type PlaceInfo, findBiomeCell, findRegionCell, getBiomeCellSite, getPlaceInfo, getRegionCellSite, getZoneOfBiomeCell } from "./places";
export { type CitySitePoint, getCityVoronoiSites } from "./roads/citySites";
export { type CityFreewaySidePoint, getCityFreewayEdgePoints, getCityFreewaySidePoints } from "./roads/freewaySidePoints";
export { type RoadMarkerPoint, getCityRoadMarkers, getFreewayRunMarkers } from "./roads/roadMarkers";
export { type CityTrafficLightPoint, getCityTrafficLightPoints } from "./roads/trafficLights";
export { type FreewayLampParams, type FreewayLampPoint, getFreewayRunLamps, runLampDebug } from "./roads/runLamps";
export type { BridgePlacementParams, BridgeSection, FreewayBridge } from "./bridges/types";
export { BRIDGE_PARAPET_WIDTH, DEFAULT_BRIDGE_PLACEMENT } from "./bridges/constants";
export { bridgeDeckY, bridgeLaneAlong, bridgePaintAt, bridgeParapetAt, bridgeParapetLine, bridgeSections, bridgeTrimRange } from "./bridges/deckGeometry";
export { bridgeDrawnTopAt } from "./bridges/drawnSlab";
export { bridgeDebug, getFreewayBridges } from "./bridges/freewayBridges";
export { getFreewayMouths } from "./bridges/mouths";
export { bridgeRiverCrossing } from "./bridges/rules";
export { type RockPlacementParams, type RockPoint, type RockField, ROCK_SHAPE_COUNT, getRocks } from "./rocks/rockPlacement";
export { type SnowDriftMesh, getSnowDrift, snowMovementAt } from "./snow/snowDrift";
export { type SplashEmitter, type SplashEmitterParams, getRiverSplashEmitters } from "./water/parts/splashes";
export { type WaterfallBoulder, getWaterfallBoulders, getWaterfallRocks } from "./water/parts/boulders";
export {
  type PondSurfaceEmitter,
  type PondSurfaceEmitterParams,
  type WaterEmitter,
  type WaterEmitterParams,
  getPondSurfaceEmitters,
  getWaterEmitters,
} from "./water/parts";

/** Every surface source's movement modifiers at a world point (physics/movementModifiers.ts), into
 *  `out` (reset first): what a capsule's caller samples off the stepping thread for CharacterInput.surface.
 *  `feetY` is the capsule's feet (NaN = on the ground): a source on the ground's surface ignores a capsule
 *  standing well under it (a tunnel) or over it. */
export const surfaceModifiersAt = (x: number, z: number, feetY = NaN, out: MovementModifiers = createMovementModifiers()): MovementModifiers => {
  resetMovementModifiers(out);
  snowMovementAt(x, z, out, feetY);
  return out;
};
