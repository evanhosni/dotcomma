/**
 * City dressing placement — worker client.
 *
 * The enumerations (road markers, traffic lights, freeway-side points) run in
 * utils/workers/cityDressing.worker.ts on the shared vertex pipeline; one shared
 * worker serves every dressing component (RoadMarkers, TrafficLights,
 * PowerLines). The worker also runs the per-chunk biome
 * probe, so a request costs the main thread nothing but the postMessage.
 */

import {
  CityFreewaySidePoint,
  CitySitePoint,
  CityTrafficLightPoint,
  RoadMarkerPoint,
  VertexResult,
} from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";

export type { CityFreewaySidePoint, CitySitePoint, CityTrafficLightPoint, RoadMarkerPoint };

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
const pendingRequests = new Map<number, (points: any[]) => void>();
let nextRequestId = 0;

const handleMessage = (e: MessageEvent) => {
  if (e.data.type === "DRESSING_RESULT") {
    const resolve = pendingRequests.get(e.data.id);
    if (resolve) {
      resolve(e.data.points);
      pendingRequests.delete(e.data.id);
    }
  }
};

/** Domain switch (resetDomainSystems): drop the worker so the next dressing
 *  request re-inits it with the new world's config. In-flight requests never
 *  resolve — callers unmounted with the old world. */
export const resetDressingWorker = () => {
  worker?.terminate();
  worker = null;
  initPromise = null;
  pendingRequests.clear();
};

/** Lazily spin up + init the shared worker (idempotent). */
const ensureWorker = async (): Promise<void> => {
  if (!initPromise) {
    initPromise = (async () => {
      await whenDomainReady();
      const config = getActiveDomainConfig();
      worker = new Worker(new URL("../../utils/workers/cityDressing.worker.ts", import.meta.url), {
        type: "module",
      });
      await new Promise<void>((resolve) => {
        worker!.onmessage = (e: MessageEvent) => {
          if (e.data.type === "INIT_DONE") {
            worker!.onmessage = handleMessage;
            resolve();
          }
        };
        worker!.postMessage({ type: "INIT", config });
      });
    })();
  }
  return initPromise;
};

const request = async (message: Record<string, unknown>): Promise<any[]> => {
  await ensureWorker();
  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    worker!.postMessage({ ...message, id });
  });
};

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

export interface DensityPointParams {
  seedTag: string;
  density: number;
  footprint: number;
  biomeIds?: number[];
  roadDistanceRange?: [number, number];
  heightRange?: [number, number];
}

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
