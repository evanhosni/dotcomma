/**
 * City dressing placement — worker client.
 *
 * The enumerations (road markers, traffic lights, freeway-side points) run in
 * workers/cityDressing.worker.ts on the shared vertex pipeline; one shared
 * worker serves every dressing component (RoadMarkers, TrafficLights,
 * PowerLines). The worker also runs the per-chunk biome
 * probe, so a request costs the main thread nothing but the postMessage.
 */

import {
  CityFreewaySidePoint,
  CityTrafficLightPoint,
  RoadMarkerPoint,
} from "../workers/vertexCompute";
import { getActiveWorldConfig, whenWorldReady } from "../world/registry";

export type { CityFreewaySidePoint, CityTrafficLightPoint, RoadMarkerPoint };

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

/** Lazily spin up + init the shared worker (idempotent). */
const ensureWorker = async (): Promise<void> => {
  if (!initPromise) {
    initPromise = (async () => {
      await whenWorldReady();
      const config = getActiveWorldConfig();
      worker = new Worker(new URL("../workers/cityDressing.worker.ts", import.meta.url), {
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
