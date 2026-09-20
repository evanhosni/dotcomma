/** Typed wrappers over the ONE dressing worker (utils/workers/dressing.worker.ts). */

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
    new Worker(new URL("../../utils/workers/dressing.worker.ts", import.meta.url), { type: "module" }),
  init: async () => {
    await whenDomainReady();
    return { config: getActiveDomainConfig() };
  },
  resultType: "DRESSING_RESULT",
});

/** In-flight requests never resolve after a reset — their callers unmounted with the old domain. */
export const resetDressingWorker = client.reset;

const request = (message: Record<string, unknown>): Promise<any[]> =>
  client.request<{ points: any[] }>(message).then((r) => r.points);

export const getRoadMarkers = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): Promise<RoadMarkerPoint[]> =>
  request({ type: "ROAD_MARKERS", minX, minZ, maxX, maxZ, streetSpacing, freewaySpacing });

export const getTrafficLightPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chance: number
): Promise<CityTrafficLightPoint[]> =>
  request({ type: "TRAFFIC_LIGHTS", minX, minZ, maxX, maxZ, chance });

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

/** CITY ONLY: the worker's chunk probe returns nothing outside the city biome. */
export const getDensityPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  params: DensityPointParams
): Promise<DensityPoint[]> =>
  request({ type: "DENSITY_POINTS", minX, minZ, maxX, maxZ, params });

/** Padded height sample off-thread: a flatten-tile miss costs 30–70ms, a lag spike on the main
 *  thread. null until the worker is initialized. */
export const getVertexSample = async (x: number, z: number): Promise<VertexResult | null> => {
  const points = await request({ type: "VERTEX_SAMPLE", x, z });
  return (points[0] as VertexResult) ?? null;
};

/** Off-thread for the same reason as getVertexSample (each site can compute a pad tile). */
export const getCityLightSites = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): Promise<CitySitePoint[]> => request({ type: "CITY_SITES", minX, minZ, maxX, maxZ });
