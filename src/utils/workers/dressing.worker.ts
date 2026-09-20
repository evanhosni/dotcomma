/**
 * Dressing placement worker: the city feature enumerators, generic density
 * points, city-light sites and padded height samples, behind a cheap
 * chunk-center biome probe.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "ROAD_MARKERS",   id, minX, minZ, maxX, maxZ, streetSpacing, freewaySpacing }
 *   IN:  { type: "TRAFFIC_LIGHTS", id, minX, minZ, maxX, maxZ, chance }
 *   IN:  { type: "FREEWAY_SIDES",  id, minX, minZ, maxX, maxZ, spacing, lateral, junctionClear, withNext }
 *   IN:  { type: "DENSITY_POINTS", id, minX, minZ, maxX, maxZ, params: DensityPointParams }
 *   IN:  { type: "CITY_SITES",     id, minX, minZ, maxX, maxZ } (no biome probe — big windows)
 *   IN:  { type: "VERTEX_SAMPLE",  id, x, z } (single padded height sample — Player backstop)
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "DRESSING_RESULT", id, points }
 */

import {
  computeVertexData,
  getCityFreewaySidePoints,
  getCityRoadMarkers,
  getCityTrafficLightPoints,
  getCityVoronoiSites,
  initCompute,
  DomainConfig,
} from "./vertexCompute";
import { generateDensityPoints } from "./densityPoints";
import { CITY_BIOME_ID } from "../../world/constants";

let initialized = false;

/** No city roads possible here: center in another biome and no boundary in reach. */
const probeEmpty = (minX: number, minZ: number, maxX: number, maxZ: number): boolean => {
  const vd = computeVertexData((minX + maxX) / 2, (minZ + maxZ) / 2);
  return vd.biomeId !== CITY_BIOME_ID && vd.distanceToBiomeBoundaryCenter > (maxX - minX) * 0.75;
};

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  const { id, minX, minZ, maxX, maxZ } = e.data;

  // A flatten-tile miss costs 30-70ms — the Player confirms its backstop here instead of on the main thread.
  if (type === "VERTEX_SAMPLE") {
    const points = initialized ? [computeVertexData(e.data.x, e.data.z)] : [];
    (self as any).postMessage({ type: "DRESSING_RESULT", id, points });
    return;
  }

  // City-site scans use huge windows (~1800u), where the chunk-center probe doesn't apply.
  if (type === "CITY_SITES") {
    const points = initialized ? getCityVoronoiSites(minX, minZ, maxX, maxZ) : [];
    (self as any).postMessage({ type: "DRESSING_RESULT", id, points });
    return;
  }

  const empty = !initialized || probeEmpty(minX, minZ, maxX, maxZ);
  let points: unknown[] = [];

  if (!empty && type === "ROAD_MARKERS") {
    points = getCityRoadMarkers(minX, minZ, maxX, maxZ, e.data.streetSpacing, e.data.freewaySpacing);
  } else if (!empty && type === "TRAFFIC_LIGHTS") {
    points = getCityTrafficLightPoints(minX, minZ, maxX, maxZ, e.data.chance);
  } else if (!empty && type === "FREEWAY_SIDES") {
    points = getCityFreewaySidePoints(
      minX,
      minZ,
      maxX,
      maxZ,
      e.data.spacing,
      e.data.lateral,
      e.data.junctionClear,
      e.data.withNext
    );
  } else if (!empty && type === "DENSITY_POINTS") {
    points = generateDensityPoints(minX, minZ, maxX, maxZ, e.data.params);
  }

  (self as any).postMessage({ type: "DRESSING_RESULT", id, points });
};
