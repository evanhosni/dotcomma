/**
 * THE dressing enumerator table: name → placement function over one chunk's bounds. The dressing
 * worker runs these for the client (its ENUMERATE message; `enumerateDressing` in dressingWorker.ts
 * is the typed request), and the server runs the collider-bearing ones in-thread for its obstacles
 * (catalog.ts). Three-free. A new enumerator = its function + one entry here.
 *
 * Every enumerator must be deterministic and duplicate-free under chunked queries (a point belongs
 * to the chunk holding its owning position) — utils/workers/roads/cityFeatures.test.ts.
 */

import {
  type BridgePlacementParams,
  type CityFreewaySidePoint,
  type CitySitePoint,
  type CityTrafficLightPoint,
  type FreewayBridge,
  type FreewayLampParams,
  type FreewayLampPoint,
  type RoadMarkerPoint,
  computeVertexData,
  getCityFreewayEdgePoints,
  getCityRoadMarkers,
  getCityTrafficLightPoints,
  getCityVoronoiSites,
  getFreewayBridges,
  getFreewayRunLamps,
  getFreewayRunMarkers,
} from "../../utils/workers/vertexCompute";
import { type DensityPointParams, generateDensityPoints } from "../../utils/workers/densityPoints";
import { CITY_BIOME_ID } from "../../world/constants";
import type { DressingBounds } from "./types";

/** A chunk's center within this fraction of the chunk size of a biome wall may hold another biome. */
const PROBE_WALL_REACH = 0.75;

/** False when no point of `biomeIds` can lie in the chunk: its center is in another biome with no
 *  biome wall in reach. Unset/empty `biomeIds` = every biome. One padded height per call. */
export const chunkMayHoldBiomes = (b: DressingBounds, biomeIds: readonly number[] | undefined): boolean => {
  if (!biomeIds || biomeIds.length === 0) return true;
  const vd = computeVertexData((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  return !(!biomeIds.includes(vd.biomeId) && vd.distanceToBiomeBoundaryCenter > (b.maxX - b.minX) * PROBE_WALL_REACH);
};

const CITY_ONLY = [CITY_BIOME_ID];

export interface DensityPoint {
  x: number;
  y: number;
  z: number;
}

export interface RoadMarkerArgs {
  streetSpacing: number;
  freewaySpacing: number;
}

export interface TrafficLightArgs {
  /** Seeded fraction of eligible intersections that get signals. */
  chance: number;
}

export interface FreewayEdgeArgs {
  spacing: number;
  /** Past the freeway edge (the config's freewayWidth is added by the enumerator). */
  lateralMargin: number;
  /** Runs stop this close to a crossing freeway. */
  junctionClear: number;
  /** Which side of each freeway carries points (+1 / −1). */
  side: number;
  /** Each point also carries its successor (wire spans across chunk borders). */
  withNext?: boolean;
}

type Enumerator<A, P> = (b: DressingBounds, args: A) => P[];
const defineEnumerators = <T extends Record<string, Enumerator<any, any>>>(table: T): T => table;

export const DRESSING_ENUMERATORS = defineEnumerators({
  /** Spawn-style density placement (densityPoints.ts), skipped where none of `biomeIds` can be. */
  densityPoints: (b, params: DensityPointParams): DensityPoint[] =>
    chunkMayHoldBiomes(b, params.biomeIds) ? generateDensityPoints(b.minX, b.minZ, b.maxX, b.maxZ, params) : [],

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
});

export type DressingEnumeratorName = keyof typeof DRESSING_ENUMERATORS;
export type EnumeratorArgs<K extends DressingEnumeratorName> = Parameters<(typeof DRESSING_ENUMERATORS)[K]>[1];
export type EnumeratorPoint<K extends DressingEnumeratorName> = ReturnType<(typeof DRESSING_ENUMERATORS)[K]>[number];

export const isDressingEnumerator = (name: string): name is DressingEnumeratorName =>
  Object.prototype.hasOwnProperty.call(DRESSING_ENUMERATORS, name);

export const runDressingEnumerator = <K extends DressingEnumeratorName>(
  name: K,
  bounds: DressingBounds,
  args: EnumeratorArgs<K>
): EnumeratorPoint<K>[] => (DRESSING_ENUMERATORS[name] as Enumerator<EnumeratorArgs<K>, EnumeratorPoint<K>>)(bounds, args);
