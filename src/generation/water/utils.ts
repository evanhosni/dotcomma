/**
 * WHAT THE WATER READS OF THE WORLD AROUND IT: the GROUND it hangs from, and the ROADS. Three-free.
 *
 * The ground: what a river's surface, a pond's level and a gap's rise read of the terrain at a warped
 * point, with whatever lake lies beside it. Every evaluation runs with the vertex in progress saved and
 * restored (its wall pass and lake shore): rivers and ponds are built mid-vertex in places.
 *
 * The roads: the one door between the water code and roads/, bridges/ and the city — nothing else under
 * water/ imports a road module (the city adapts to rivers; where they conflict, the road wins:
 * generation/water/DECISIONS.md "The road layer"). Known duplication, kept on purpose: the river's road layer
 * (generation/water/rivers/road-layer/index.ts) judges whether a deck could carry a road over a wet stretch with the bridge
 * builder's own rules re-exported here, but in its own code; the two have disagreed before
 * (generation/water/DECISIONS.md "Known, not fixed").
 *
 * Every function here that reads a pipeline module is this module's own: they are in the pipeline's import
 * cycle, and a RE-export is read when this module loads (generation/water/rivers/index.ts). Only leaves are re-exported.
 */

import { distanceToSegment } from "../../utils/math";
import { roadBearingBiomeIds } from "../registry";
import { edgeRoadPathsUnbuilt } from "../bridges/chains";
import { deckPathTurn as pathTurn } from "../bridges/rules";
import type { RoadPath } from "../bridges/types";
import { domainConfig } from "../store";
import { unwarp } from "../utils";
import { FREEWAY_LINK_CELLS } from "../roads/freeways/network/constants";
import { freewayRunDistance } from "../roads/freeways/network";
import { cityWallDistance } from "../roads/freeways";
import { waterTerrainAt } from "..";
import { biomeSiteAt, getBiomeContext } from "../zones";
import { accumulateWallFields, combineZoneWeights, restoreWallPass, saveWallPass, zoneFinal, zoneWeights } from "../zones/blend";
import { isLakeBiome } from "./lakes/params";
import { lakeShore, lakeSurface, lastLakeLevel, lastShoreDistance, restoreShore, saveShore, shoreLiftShare } from "./lakes";

/** Runs `f` with the current vertex's wall pass and lake shore put back after. */
export const keepingVertex = <T>(f: () => T): T => {
  const pass = saveWallPass();
  const shore = saveShore();
  try {
    return f();
  } finally {
    restoreWallPass(pass);
    restoreShore(shore);
  }
};

/** The terrain at a warped point (zone-blended, without roads, a <Quays/> biome at its floor, lifted with
 *  a lake's shore), with what a lake beside it says there: the signed distance to its wall (+ on land,
 *  clamped), its level (NaN: none in reach), how much of the shore lift holds the land, how far the level's
 *  support reaches and over how far a river eases onto it. */
export const waterGroundAt = (wx: number, wz: number): { h: number; shore: number; level: number; lift: number; fade: number; approach: number } =>
  keepingVertex(() => {
    const ctx = getBiomeContext({ x: wx, z: wz });
    accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
    combineZoneWeights(zoneWeights, zoneFinal);
    lakeSurface(ctx.warped, ctx, ctx.zone);
    const w = unwarp(wx, wz);
    const h = waterTerrainAt(w.x, w.z, ctx.zone, ctx);
    return { h, shore: lastShoreDistance(), level: lastLakeLevel(), lift: shoreLiftShare(), fade: lakeShore.support, approach: lakeShore.approach };
  });

/** The NATURAL ground at a warped point — zone-blended, without roads, water or valleys, a <Quays/> biome at its
 *  floor, never lifted onto a shore — or NaN inside a lake zone: what a lake's level is held under
 *  (lakes/ lakeCellLevel). */
export const naturalGroundAt = (wx: number, wz: number): number =>
  keepingVertex(() => {
    const ctx = getBiomeContext({ x: wx, z: wz });
    if (isLakeBiome(ctx.zone.biome)) return NaN;
    accumulateWallFields(wx, wz, ctx.zoneWalls, ctx.zone);
    combineZoneWeights(zoneWeights, zoneFinal);
    lakeShore.level = NaN;
    lakeShore.bowlFloor = NaN;
    const w = unwarp(wx, wz);
    return waterTerrainAt(w.x, w.z, ctx.zone, ctx);
  });

export type { RoadPath } from "../bridges/types";
export { BRIDGE_ALONG_ALIGN, BRIDGE_MAX_ALONG_SHORE, BRIDGE_MAX_TURN, BRIDGE_MIN_CROSSING, BRIDGE_WET_MERGE, deckWidth, runRiverYield } from "../bridges/constants";
export { segIntersect } from "../bridges/utils";
/** How sharply a road path turns over a deck's span (generation/bridges/rules/index.ts). */
export const deckPathTurn = (xs: number[], zs: number[]): number => pathTurn(xs, zs);
/** The roads (runs, belts, arterials) near a river's pieces, as the bridges see them. */
export const roadPathsNear = (...args: Parameters<typeof edgeRoadPathsUnbuilt>): RoadPath[] => edgeRoadPathsUnbuilt(...args);

/** A freeway's half-width (real units): every "within reach of a road" in the water code is past it. */
export const freewayHalfWidth = (): number => domainConfig!.cityConfig.freewayWidth;

/** Whether a biome bears roads of its own (streets, arterials, a belt). */
export const bearsRoads = (biomeId: number): boolean => roadBearingBiomeIds().includes(biomeId);

/** Whether a road-bearing biome — the only source of freeways — lies near enough the warped segment a→b
 *  for a road to reach it (its freeway links' reach). */
export const roadsMayReach = (ax: number, az: number, bx: number, bz: number): boolean => {
  const gs = domainConfig!.gridSize;
  const reach = (FREEWAY_LINK_CELLS + 2) * gs;
  for (let ix = Math.floor((Math.min(ax, bx) - reach) / gs); ix <= Math.floor((Math.max(ax, bx) + reach) / gs); ix++) {
    for (let iz = Math.floor((Math.min(az, bz) - reach) / gs); iz <= Math.floor((Math.max(az, bz) + reach) / gs); iz++) {
      const s = biomeSiteAt(ix, iz);
      if (bearsRoads(s.zone.biome.id) && distanceToSegment(s.x, s.z, ax, az, bx, bz) < reach) return true;
    }
  }
  return false;
};

/** Whether a road comes within a pond's `footprint` (real units) plus a freeway's half-width of a warped
 *  point. A river's ponds pass the `roads` its road layer read (the network is never asked from inside a
 *  river: a city's waterfront builds the river it would ask about); a standalone pond passes null and asks
 *  the network — any freeway run or a road-bearing biome's wall — through its pure distance queries (its
 *  ponds are placed mid-vertex, and the vertex in progress keeps its own road probes). */
export const pondTouchesRoad = (x: number, z: number, footprint: number, roads: readonly RoadPath[] | null): boolean => {
  const reach = footprint + freewayHalfWidth();
  if (roads) {
    for (const path of roads) {
      for (let i = 0; i < path.wx.length; i++) {
        const j = Math.min(i + 1, path.wx.length - 1);
        if (distanceToSegment(x, z, path.wx[i], path.wz[i], path.wx[j], path.wz[j]) < reach) return true;
      }
    }
    return false;
  }
  return freewayRunDistance(x, z) < reach || cityWallDistance(x, z) < reach;
};
