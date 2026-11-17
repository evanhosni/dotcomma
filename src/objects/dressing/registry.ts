import { BRIDGES_SPEC } from "./bridges/spec";
import { POWER_LINES_SPEC } from "./power-lines/spec";
import { ROCKS_SPEC } from "./rocks/spec";
import { FREEWAY_LAMPS_SPEC, STREET_LAMPS_SPEC } from "./street-lamps/spec";
import { TRAFFIC_LIGHTS_SPEC } from "./traffic-lights/spec";
import { WATERFALL_BOULDERS_SPEC } from "./waterfall-boulders/spec";
import type { DressingColliderSpec, ChunkBounds, Enumerator, DensityPoint, RoadMarkerArgs, TrafficLightArgs, FreewayEdgeArgs, DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./types";
import type { BridgePlacementParams, CityFreewaySidePoint, CitySitePoint, CityTrafficLightPoint, FreewayBridge, FreewayLampParams, FreewayLampPoint, RoadMarkerPoint, RockPlacementParams, RockPoint, SnowDriftMesh, SplashEmitter, SplashEmitterParams, PondSurfaceEmitter, PondSurfaceEmitterParams, WaterEmitter, WaterEmitterParams } from "../../generation";
import { biomeFieldAt, getCityFreewayEdgePoints, getCityRoadMarkers, getCityTrafficLightPoints, getCityVoronoiSites, getFreewayBridges, getFreewayRunLamps, getFreewayRunMarkers, getRiverSplashEmitters, getRocks, getWaterfallRocks, getSnowDrift, getPondSurfaceEmitters, getWaterEmitters } from "../../generation";
import { biomeIdsWith } from "../../generation/registry";
import { rockFieldBiomeIds } from "../../generation/rocks/params";
import { snowBiomeIds } from "../../generation/snow/params";
import { bodyBiomeIds } from "../../generation/water/parts/params";
import { biomesWeighWithin } from "../../generation/zones/blend";
import type { DensityPointParams } from "../../generation/placement/types";
import { generateDensityPoints } from "../../generation/placement";
import { CITY_BIOME_ID } from "../../world/constants";

/** Every dressing feature with colliders — the ONE list the server's server/src/game/physics/bodies/index.ts builds from (the
 *  dressing twin of objects/actors/registry.ts). A solid feature = its Three-free `*Spec.ts` + one line here.
 *  Order = the server's body order per chunk. */
export const DRESSING_COLLIDER_SPECS: readonly DressingColliderSpec[] = [
  BRIDGES_SPEC,
  STREET_LAMPS_SPEC,
  TRAFFIC_LIGHTS_SPEC,
  POWER_LINES_SPEC,
  FREEWAY_LAMPS_SPEC,
  ROCKS_SPEC,
  WATERFALL_BOULDERS_SPEC,
];

/**
 * THE dressing enumerator table: name → placement function over one chunk's bounds. The dressing
 * worker runs these for the client (its ENUMERATE message; `enumerateDressing` in dressingWorker.ts
 * is the typed request), and the server runs the collider-bearing ones in-thread for its obstacles
 * (catalog.ts). Three-free. A new enumerator = its function + one entry here.
 *
 * Every enumerator must be deterministic and duplicate-free under chunked queries (a point belongs
 * to the chunk holding its owning position) — generation/roads/tests/cityFeatures.test.ts.
 */

/** False when no point of the chunk can carry any weight of `biomeIds` (generation/zones/blend/index.ts
 *  `biomesWeighWithin`, from the center's slot sdfs over the chunk's half diagonal). Unset/empty
 *  `biomeIds` = every biome. One wall pass per call (`biomeFieldAt`: a whole padded vertex here was
 *  1554 ms of the snow enumerator over 133 city chunks, 16 ms now). Biome walls are never far (500u cells), so
 *  a probe by the distance to the nearest wall skipped almost nothing; the slot sdfs say which biome
 *  is across it. */
const chunkMayHoldBiomes = (b: ChunkBounds, biomeIds: readonly number[] | undefined): boolean => {
  if (!biomeIds || biomeIds.length === 0) return true;
  const field = biomeFieldAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  return biomeIds.includes(field.biomeId) || biomesWeighWithin(field.biomeSdf, biomeIds, (b.maxX - b.minX) * Math.SQRT1_2);
};

const CITY_ONLY = [CITY_BIOME_ID];
const defineEnumerators = <T extends Record<string, Enumerator<any, any>>>(table: T): T => table;

export const DRESSING_ENUMERATORS = defineEnumerators({
  /** Spawn-style density placement (generation/placement/index.ts), skipped where none of `biomeIds` can be. */
  densityPoints: (b, params: DensityPointParams): DensityPoint[] =>
    chunkMayHoldBiomes(b, params.biomeIds ?? (params.feature ? biomeIdsWith(params.feature) : undefined))
      ? generateDensityPoints(b.minX, b.minZ, b.maxX, b.maxZ, params)
      : [],

  /** City street/arterial/belt centerlines, plus the inter-city runs, which cross open country. */
  roadMarkers: (b, a: RoadMarkerArgs): RoadMarkerPoint[] => {
    const inCity = chunkMayHoldBiomes(b, CITY_ONLY);
    const runs = getFreewayRunMarkers(b.minX, b.minZ, b.maxX, b.maxZ, a.freewaySpacing);
    return inCity ? runs.concat(getCityRoadMarkers(b.minX, b.minZ, b.maxX, b.maxZ, a.streetSpacing, a.freewaySpacing)) : runs;
  },

  trafficLights: (b, a: TrafficLightArgs): CityTrafficLightPoint[] =>
    chunkMayHoldBiomes(b, CITY_ONLY) ? getCityTrafficLightPoints(b.minX, b.minZ, b.maxX, b.maxZ, a.chance) : [],

  freewayEdgePoints: (b, a: FreewayEdgeArgs): CityFreewaySidePoint[] =>
    chunkMayHoldBiomes(b, CITY_ONLY)
      ? getCityFreewayEdgePoints(b.minX, b.minZ, b.maxX, b.maxZ, a.spacing, a.lateralMargin, a.junctionClear, a.side, a.withNext ?? false)
      : [],

  /** Lamps along the inter-city runs, which cross every region — no probe. */
  freewayLamps: (b, params: FreewayLampParams): FreewayLampPoint[] => getFreewayRunLamps(b.minX, b.minZ, b.maxX, b.maxZ, params),

  /** Decks also stand on inter-city runs outside the city — no probe. */
  bridges: (b, params: BridgePlacementParams): FreewayBridge[] => getFreewayBridges(b.minX, b.minZ, b.maxX, b.maxZ, params),

  /** Window-sized scans (~1800u), where a chunk-center probe does not apply. */
  cityLightSites: (b, _args: Record<string, never>): CitySitePoint[] => getCityVoronoiSites(b.minX, b.minZ, b.maxX, b.maxZ),

  /** Every `rocks` biome's field and every cave mouth's spots (skipped where none of the fields' biomes can be:
   *  a mouth's spots lie in its cave biome). */
  rocks: (b, params: RockPlacementParams): RockPoint[] => (chunkMayHoldBiomes(b, rockFieldBiomeIds()) ? getRocks(b.minX, b.minZ, b.maxX, b.maxZ, params) : []),

  /** The boulders of every river, where the domain's <Water> mounts <WaterfallBoulders/> (rivers cross
   *  every region: no probe). */
  waterfallBoulders: (b, _args: Record<string, never>): RockPoint[] => getWaterfallRocks(b.minX, b.minZ, b.maxX, b.maxZ),

  /** The chunk's one snow sheet, or nothing. Skipped where no snow biome's cover can reach: the sheet
   *  samples ~17k drawn-ground heights per 256u chunk before it knows it is empty, and every chunk of
   *  every region paid that (the dressing worker's time tripled on a city flight; PERFORMANCE.md). */
  snowDrift: (b, _args: Record<string, never>): SnowDriftMesh[] => (chunkMayHoldBiomes(b, snowBiomeIds()) ? getSnowDrift(b) : []),

  /** Rivers cross every region: no biome probe. */
  waterfallSplashes: (b, params: SplashEmitterParams): SplashEmitter[] => getRiverSplashEmitters(b.minX, b.minZ, b.maxX, b.maxZ, params),

  /** A water part's emitters (its bodies are the driver's mounts). Skipped where none of the biomes
   *  carrying those bodies can be (a body owns water only where a biome carries it). */
  waterEmitters: (b, params: WaterEmitterParams): WaterEmitter[] =>
    chunkMayHoldBiomes(b, bodyBiomeIds(params.bodies.map((body) => body.slot)))
      ? getWaterEmitters(b.minX, b.minZ, b.maxX, b.maxZ, params)
      : [],

  /** A pond part's emitters on its still surface (its bodies are the driver's mounts). */
  pondSurfaceEmitters: (b, params: PondSurfaceEmitterParams): PondSurfaceEmitter[] =>
    chunkMayHoldBiomes(b, bodyBiomeIds(params.bodies.map((body) => body.slot)))
      ? getPondSurfaceEmitters(b.minX, b.minZ, b.maxX, b.maxZ, params)
      : [],
});

export const isDressingEnumerator = (name: string): name is DressingEnumeratorName =>
  Object.prototype.hasOwnProperty.call(DRESSING_ENUMERATORS, name);

export const runDressingEnumerator = <K extends DressingEnumeratorName>(
  name: K,
  bounds: ChunkBounds,
  args: EnumeratorArgs<K>
): EnumeratorPoint<K>[] => (DRESSING_ENUMERATORS[name] as Enumerator<EnumeratorArgs<K>, EnumeratorPoint<K>>)(bounds, args);
