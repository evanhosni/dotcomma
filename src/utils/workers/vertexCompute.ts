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
import { domainConfig, setDomainConfig } from "./computeConfig";
import { applyFlattenPads, computeVertexDataRaw, evaluatingPadCandidates, initFlattenPads, padsApplyIn } from "./flattenPads";
import { clearLakeCaches, lakeBedBumps, lakeBowlHeight, lakeLevelAt, lakeSurface, lastMergeLevel, mergeFloor, riverLakeMerge, riverMouthShare, riverSurfaceBesideCrispShore, shoreLift } from "./lakes";
import { biomeNoiseHeight, terrainNoise, warp } from "./noise";
import { initPlaces } from "./places";
import { capRiverBed } from "./rivers/riverBedLimit";
import { carveRiverChannel, riverWaterBand } from "./rivers/riverChannel";
import { clearRiverField, noRiverQuay, noRiverSample, riverFieldAt, riverQuay, riverQuayAt, riverSample } from "./rivers/riverField";
import { initRivers } from "./rivers/riverNetwork";
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
import { FREEWAY_SMIN_K, type WallNetwork, clearNetworkCache, nearestFreewayRun, nearestRun, networkOf, smoothMin } from "./roads/freewayNetwork";
import { FRAGMENT_REMOVED_FIELD, FRAGMENT_RIVER_REACH, ISLAND_LAND_FIELD, TO_BANK, TO_ROAD, blockIslandAt, clearRoadFragments, islandRoad, inRoadFragment } from "./roads/roadFragments";
import type { BiomeContext, DomainConfig, SerializedRegion, VertexResult, Zone } from "./types";
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

/** Past the riverbed's reach a vertex still carries the bed's own texture distances this far (real
 *  units): a quad reaching into the bed interpolates them (LOD2 spacing 17.5u). */
const RIVERBED_SDF_MARGIN = 30;
/** A city vertex on the river side of the quay reports its riverbed paint distance at most this
 *  far inside the STRAIGHT bank edge (factor-1 units): past the fade the bed shader applies, so the
 *  sand begins whole exactly where the quay's river-side sidewalk ends (see riverBedDistance). */
const QUAY_BED_INSET = RIVER_BED_FULL_INSET;
/** The quay's riverbed paint distance at the vertex riverQuayAt last measured: its straight distance
 *  less QUAY_BED_INSET, never below where the bed is whole. */
/** A river merges into the lake beside it (step 4) only this far (real units) past a freeway's
 *  half-width, fully from the second: a road along the shore stays on dry ground, and so do its decks. */
const MERGE_ROAD_NEAR = 10;
const MERGE_ROAD_FAR = 40;
const quayBedDistance = (): number => {
  const river = domainConfig!.river;
  return Math.max(riverQuay.distance / riverQuay.factor - QUAY_BED_INSET, river.halfWidth + river.bank - RIVER_BED_FULL_INSET);
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
    if (Number.isNaN(level)) return -zone.biome.water.depth * presence + lakeBedBumps(ctx.warped, presence);
    return lakeBowlHeight(level, zone.biome.water.depth, presence, ctx.warped) - terrainNoise(zone.baseNoise, x, z);
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

/** Whether a world point lies outside every one of `biomeIds` (none = every biome) — exactly the
 *  biomeId test of passesPlacementFilters, from the point's own zone alone: a placement checks it
 *  before paying for the whole vertex (most of a city descriptor's rolls fall outside the city). */
export const outsideBiomes = (biomeIds: readonly number[] | undefined, x: number, z: number): boolean =>
  !!biomeIds && biomeIds.length > 0 && !biomeIds.includes(getBiomeContext(warp(x, z)).zone.biome.id);

/** Set while a FAR VISUAL-ONLY terrain vertex is evaluated (computeVertexDataFar). */
let farVisual = false;
/** Set while a far vertex is evaluated WITHOUT the river field (computeVertexDataFar, rivers = false). */
let farDry = false;
const NO_RUNS: WallNetwork["freeways"] = [];

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

/** One vertex of the full pipeline. `cutDecks` false (a terrain LOD whose LODLevel.cutsDecks is false)
 *  leaves out step 7, the ground under the decks, and with it the cell's deck enumeration; the
 *  lane-end, fragment and island steps run as everywhere a cell has no deck. */
export function computeVertexData(x: number, z: number, cutDecks = true): VertexResult {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const river = domainConfig.river;

  // Step 0: the decks whose ground this vertex may have to cut (step 7) — fetched FIRST: enumerating a
  // cell's decks evaluates the terrain (their landed ends), which clobbers every scratch buffer below.
  const decksKnown = !evaluatingPadCandidates && enumeratingBridges === 0;
  const cellDecks = decksKnown && cutDecks ? decksAround(x, z) : NO_DECKS;

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
  // The city's own wall, before a drowned belt is pushed off it (step 4's merge keeps clear of the city).
  const cityWallAway = offCity ? nearestCityWall.distance : 0;
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
  let distanceToRoadCenter = NO_ROAD_DISTANCE; // normalized street units; set by the city field or step 5
  let distanceToFreewayCenter = NO_ROAD_DISTANCE;
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
    riverBedDistance = Math.min(distanceToRiver, quayBedDistance());
  } else if (quayBeside && nearestCityWall.wall < BELT_FIELD_HANDOFF) {
    // Just outside the wall the same rule hands over to the river's own distance, so the sand does
    // not start on a line along the wall (9u of bed distance apart, beside a river leaving a city).
    const quayBed = quayBedDistance();
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
      if (nearestRun.distance < fw + FREEWAY_MERGE_CLEAR) distanceToFreewayCenter = NO_ROAD_DISTANCE;
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
  const groundBeforeRiver = height;
  const riverReach = river.halfWidth + river.bank;
  const waterBand = riverWaterBand(river);
  const riverSurface = distanceToRiver < riverReach ? riverSurfaceBesideCrispShore(riverSample.surface) : NaN;
  // The bed ends where its bank first gets too steep going outward, never to resume beyond — wherever
  // the paint reaches. Not in a city: past the city's edge roads its ground is the bank, and capped,
  // its plaza showed as grey tongues on the sand; its pavement keeps the bed off by itself (the shader's
  // pavement mask). Capped only inside the river's footprint, the paint's edge stepped along that line.
  // Just outside the wall the cap comes in over BELT_FIELD_HANDOFF, so the paint does not step there.
  if (riverBedDistance < riverReach && city === null) {
    const capped = capRiverBed(riverBedDistance, riverSample.bedLimit);
    riverBedDistance += (capped - riverBedDistance) * (quayBeside ? smoothstep(0, BELT_FIELD_HANDOFF, nearestCityWall.wall) : 1);
  }
  let mouth = 0;
  // The river's water as drawn here (NaN outside its water band).
  let riverWater = NaN;
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
    if (distanceToRiver < waterBand) {
      riverWater = surface;
      waterHeight = Number.isNaN(waterHeight) ? surface : Math.max(waterHeight, surface);
    }
  }
  // A river BESIDE a lake (riverLakeMerge): the land between them, the river's lake-side bank and the
  // lake's beach there go under the lake's level — one water, no levee. Never in a city or on a road
  // (quays, the belt and a run along the shore stay dry, and with them every deck's landing).
  // (roadReal is NaN where no road is in reach at all: the smooth minimum of two infinities.) The city's
  // wall counts even where its belt is pushed off it (a waterfront): sunk beside it, the lake's beach
  // stood 9u under the city's crisp edge.
  const roadAway = Math.min(Number.isNaN(roadReal) ? Infinity : roadReal, cityWallAway);
  if (city === null && riverSample.shore < Infinity && roadAway > fw + MERGE_ROAD_NEAR) {
    const merge =
      smoothstep(fw + MERGE_ROAD_NEAR, fw + MERGE_ROAD_FAR, roadAway) *
      riverLakeMerge(groundBeforeRiver, distanceToRiver, riverFactor, riverSample.surface, riverSample.shore, riverSample.level, river);
    if (merge > 0) {
      height += (Math.min(height, mergeFloor()) - height) * merge;
      // The water comes onto the lake's level with the share: in the river's band its own surface eased
      // there; outside it the level, or where the river runs under the lake, that surface (under the
      // ground) as the share fades — continuous wherever the share reaches 0, and the two agree at the
      // band's edge (to the surface tolerance riverLakeMerge allows above the level).
      const level = lastMergeLevel();
      const merged = Number.isNaN(riverWater)
        ? level + Math.min(0, riverSample.surface - level) * (1 - merge)
        : riverWater + (level - riverWater) * merge;
      waterHeight = Number.isNaN(lakeLevel) ? merged : Math.max(lakeLevel, merged);
      // Painted as the river's bed, whole (what lies under the river beside it), never as the land.
      riverBedDistance += (Math.min(riverBedDistance, riverReach - RIVER_BED_FULL_INSET) - riverBedDistance) * merge;
    }
  }
  // 1 on open ground, 0 in the channel. The city's arterials and belt cross the river on decks: no
  // lane paint on the riverbed.
  const channel = Number.isNaN(riverSurface) ? 1 : smoothstep(waterBand, riverReach, distanceToRiver);
  if (city !== null && channel < 0.999) distanceToFreewayCenter = NO_ROAD_DISTANCE;

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
export { getRiverSegments, riverDebug } from "./rivers/riverNetwork";
export { riverKeepOff } from "./rivers/constants";
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
