/**
 * Dressing placement worker (city features + generic density points + height samples).
 *
 * Runs the deterministic city feature enumerations (road markers, traffic
 * lights, freeway-side points) OFF the main thread — the same shared vertex
 * pipeline the terrain/spawn/grass workers run. The main thread only builds
 * InstancedMeshes from the returned points, so dressing chunks can never
 * stall a frame the way main-thread computeVertexData loops did.
 *
 * Each request carries its chunk bounds; the worker runs the cheap biome
 * probe (chunk center in another biome AND no boundary in reach → no city
 * roads) before the full enumeration, so far-from-city chunks cost one
 * vertex computation.
 *
 * Messages:
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
import {
  DensityPointParams,
  densityCellRange,
  densityCellSize,
  densityProbability,
  passesPlacementFilters,
  rollDensityCell,
} from "./densityPlacement";
import { CITY_BIOME_ID } from "../../world/constants";

let initialized = false;

// ── Density-grid placement (spawn-system style, but stateless) ──
// The same density-cell + seeded-jitter + probability-roll scheme as
// spawn.worker.ts, made fully DETERMINISTIC per query: spacing is a greedy
// pass in global cell order over a footprint-padded window instead of a
// stateful cross-chunk hash, so a chunk always produces the same points no
// matter the visit order. Used for mass static dressing (street lights) that
// renders instanced instead of as per-object spawn components. Ownership is
// by candidate position, so chunked calls never emit duplicates; spacing
// chains cut at the window edge can, rarely, leave a cross-border pair
// slightly tighter than `footprint` — cosmetically irrelevant for dressing.

const generateDensityPoints = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  p: DensityPointParams
): { x: number; y: number; z: number }[] => {
  const cellSize = densityCellSize(p.density);
  const pad = p.footprint + cellSize;
  const [gx0, gx1] = densityCellRange(minX - pad, maxX + pad, cellSize);
  const [gz0, gz1] = densityCellRange(minZ - pad, maxZ + pad, cellSize);
  const probability = densityProbability(p.density, cellSize);
  const footprintSq = p.footprint * p.footprint;

  const accepted: { x: number; z: number; y: number }[] = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const roll = rollDensityCell(p.seedTag, gx, gz, cellSize, probability);
      if (!roll) continue;
      const { x, z } = roll;

      const vd = computeVertexData(x, z);
      if (!passesPlacementFilters(vd, p)) continue;

      // Greedy spacing in global (gx, gz) order — deterministic, no state.
      let blocked = false;
      for (let i = accepted.length - 1; i >= 0; i--) {
        const a = accepted[i];
        const dx = x - a.x;
        const dz = z - a.z;
        if (dx * dx + dz * dz < footprintSq) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      accepted.push({ x, z, y: vd.height });
    }
  }

  // Ownership: emit only points inside the queried bounds (padded ring cells
  // participated in spacing but belong to neighboring chunks).
  return accepted
    .filter((a) => a.x >= minX && a.x < maxX && a.z >= minZ && a.z < maxZ)
    .map((a) => ({ x: a.x, y: a.y, z: a.z }));
};

/** True when the chunk can't contain city roads (mirror of the probe the
 *  main-thread chunk hook used to run). */
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

  // Single PADDED vertex sample (Player backstop confirm) — a flatten-tile
  // miss inside computeVertexData costs 30-70ms, which is exactly why the
  // Player routes it here instead of paying it on the main thread.
  if (type === "VERTEX_SAMPLE") {
    const points = initialized ? [computeVertexData(e.data.x, e.data.z)] : [];
    (self as any).postMessage({ type: "DRESSING_RESULT", id, points });
    return;
  }

  // City-site scans use HUGE windows (scan radius ~1800) — the chunk-center
  // biome probe doesn't apply, and the site enumeration self-filters cheaply.
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
