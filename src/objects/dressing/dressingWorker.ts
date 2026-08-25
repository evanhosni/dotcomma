/**
 * City dressing placement — worker client.
 *
 * The enumerations (road markers, traffic lights, freeway-side points) run in
 * utils/workers/cityDressing.worker.ts on the shared vertex pipeline; one shared
 * worker serves every dressing component (RoadMarkers, TrafficLights,
 * PowerLines). The worker also runs the per-chunk biome
 * probe, so a request costs the main thread nothing but the postMessage.
 *
 * Lifecycle/plumbing (lazy boot, INIT handshake, request ids, teardown) comes
 * from the shared worker-client base — this file is only the typed wrappers.
 */

import {
  CityFreewaySidePoint,
  CitySitePoint,
  CityTrafficLightPoint,
  RoadMarkerPoint,
  VertexResult,
} from "../../utils/workers/vertexCompute";
import type { DensityPointParams } from "../../utils/workers/densityPlacement";
import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";

export type { CityFreewaySidePoint, CitySitePoint, CityTrafficLightPoint, RoadMarkerPoint };

const client = createWorkerClient({
  create: () =>
    new Worker(new URL("../../utils/workers/cityDressing.worker.ts", import.meta.url), { type: "module" }),
  init: async () => {
    await whenDomainReady();
    return { config: getActiveDomainConfig() };
  },
  resultType: "DRESSING_RESULT",
});

/** Domain switch (resetDomainSystems): drop the worker so the next dressing
 *  request re-inits it with the new world's config. In-flight requests never
 *  resolve — callers unmounted with the old world. */
export const resetDressingWorker = client.reset;

const request = (message: Record<string, unknown>): Promise<any[]> =>
  client.request<{ points: any[] }>(message).then((r) => r.points);

/** Raised-pavement-marker positions along city road centerlines. */
export const getRoadMarkers = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): Promise<RoadMarkerPoint[]> =>
  request({ type: "ROAD_MARKERS", minX, minZ, maxX, maxZ, streetSpacing, freewaySpacing });

/** Traffic-light pole positions on seeded-selected intersection corners. */
export const getTrafficLightPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chance: number
): Promise<CityTrafficLightPoint[]> =>
  request({ type: "TRAFFIC_LIGHTS", minX, minZ, maxX, maxZ, chance });

/** Points offset laterally from the freeway centerlines (arterials + belt). */
export const getFreewaySidePoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  spacing: number,
  lateral: number,
  junctionClear: number,
  withNext: boolean
): Promise<CityFreewaySidePoint[]> =>
  request({ type: "FREEWAY_SIDES", minX, minZ, maxX, maxZ, spacing, lateral, junctionClear, withNext });

export type { DensityPointParams };

export interface DensityPoint {
  x: number;
  y: number;
  z: number;
}

/** Deterministic spawn-system-style density placement (stateless spacing) —
 *  for mass static dressing rendered instanced (e.g. street lights). CITY
 *  ONLY: requests share the worker's city biome probe. */
export const getDensityPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  params: DensityPointParams
): Promise<DensityPoint[]> =>
  request({ type: "DENSITY_POINTS", minX, minZ, maxX, maxZ, params });

/** One PADDED vertex sample, computed in the worker. The Player's backstop
 *  confirm uses this: a flatten-tile miss inside the padded path costs
 *  30-70ms, and paying that on the main thread was a roaming lag spike.
 *  Returns null until the worker is initialized (callers fall back). */
export const getVertexSample = async (x: number, z: number): Promise<VertexResult | null> => {
  const points = await request({ type: "VERTEX_SAMPLE", x, z });
  return (points[0] as VertexResult) ?? null;
};

/** Voronoi site point of every city-biome cell in the bounds (CityLights
 *  beacons). Ran on the main thread before and each site could compute a
 *  flatten-pad tile synchronously — a periodic lag spike while roaming. */
export const getCityLightSites = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): Promise<CitySitePoint[]> => request({ type: "CITY_SITES", minX, minZ, maxX, maxZ });
