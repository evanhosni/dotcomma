import {
  CitySitePoint,
  computeVertexData,
  getCityRoadMarkers,
  getCityVoronoiSites,
  initCompute,
  RoadMarkerPoint,
  VertexResult,
} from "../workers/vertexCompute";
import { getActiveWorldConfig, whenWorldReady } from "./registry";

/**
 * Main-thread vertex queries (Player respawn raycasts, ad-hoc lookups).
 *
 * SINGLE SOURCE OF TRUTH: this is the same compute module the terrain, spawn,
 * and grass workers run (workers/vertexCompute.ts), initialized with the same
 * serialized WorldConfig from the registry. There is no separate main-thread
 * height implementation — biome heights are defined once, in the shared
 * pipeline (declarative per-biome noise configs + the city branch).
 */

let lastConfig: object | null = null;

const ensureInit = async (): Promise<void> => {
  await whenWorldReady();
  const config = getActiveWorldConfig();
  if (config !== lastConfig) {
    initCompute(config);
    lastConfig = config;
  }
};

export const getVertexData = async (x: number, y: number): Promise<VertexResult> => {
  await ensureInit();
  return computeVertexData(x, y);
};

/** Raised-pavement-marker positions along city road centerlines within the
 *  bounds (used by the RoadMarkers visual component). */
export const getRoadMarkers = async (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): Promise<RoadMarkerPoint[]> => {
  await ensureInit();
  return getCityRoadMarkers(minX, minZ, maxX, maxZ, streetSpacing, freewaySpacing);
};

/** Voronoi site point (one per city-biome cell) within the bounds — the
 *  seeded center of each city, in real world coordinates (used by the
 *  CityLights visual component). */
export const getCityLightSites = async (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): Promise<CitySitePoint[]> => {
  await ensureInit();
  return getCityVoronoiSites(minX, minZ, maxX, maxZ);
};
