/**
 * LAKES and SHORES (CLAUDE.md "Lakes, shores and the Water system").
 *
 * A lake cell's level is the region base at its SITE, a little below it so the shore
 * (where the bowl meets the base) sits above the water. The surface at a point blends the
 * levels of every water cell within LAKE_LEVEL_REACH by a compact kernel: one level per
 * cell would stand 1–3u walls of water on the wall between two lake cells of one body.
 * The 5×5 grid always holds every cell within the reach of a point in its center cell, so
 * the kernel's support never changes with the grid window (no step at grid-cell borders).
 */

import { smoothstep } from "../math/_math";
import type { PointXZ } from "../math/types";
import { dropOldestHalf } from "./cellCache";
import { domainConfig } from "./computeConfig";
import { terrainNoise, unwarp } from "./noise";
import type { BiomeContext, VoronoiCell, Zone } from "./types";
import { ZONE_WEIGHT_EPS, sstep01, zoneFinal, zoneMinDist, zones } from "./zoneBlend";

const LAKE_SURFACE_BELOW_BASE = 1.5;
const LAKE_LEVEL_REACH_CELLS = 1.5;
/** How far the shore stands above the water level, on the lake side of the wall and on the land side. */
export const SHORE_RISE = 1.5;
/** Land within this of a water wall is held at the shore height (covers the widest height
 *  window a neighbor can draw the water across: defaultHeightBlendWidth / 2), then fades
 *  back to its own relief over SHORE_CLAMP_FADE. */
const SHORE_CLAMP_FULL = 160;
const SHORE_CLAMP_FADE = 250;
/** The current point's shore clamp inputs (set by lakeSurface, read by shoreLift — also through
 *  blendedTerrainAt, so a river surface or road grade sampled beside a lake is lifted like the terrain
 *  around it). */
let shoreLevel = NaN;
let shoreDWater = Infinity;
/** In a water zone where a neighbor still has weight: the bowl's own height, which the blend may
 *  not dip under. On the wall that is the shore height the land side is lifted onto, so the two
 *  sides meet: without it a lower neighbor's share (desert salt beside the ocean) left the lake
 *  side up to 5u under the lifted land (a step along the waterline, census). */
let bowlFloor = NaN;
export const shoreLift = (h: number): number => {
  if (!Number.isNaN(bowlFloor)) return h < bowlFloor ? bowlFloor : h;
  if (Number.isNaN(shoreLevel)) return h;
  const shore = shoreLevel + SHORE_RISE;
  return h < shore ? h + (shore - h) * (1 - smoothstep(SHORE_CLAMP_FULL, SHORE_CLAMP_FULL + SHORE_CLAMP_FADE, shoreDWater)) : h;
};
/** The last lakeSurface's shore inputs: the lake level and the distance to its nearest water wall
 *  (NaN / Infinity where no lake is within the clamp's reach, or the point is IN the water). */
export const lastShore = (): { level: number; dWater: number } => ({ level: shoreLevel, dWater: shoreDWater });

/** How much of a river's channel rules at a point are a MOUTH's: 1 where the ground before the river
 *  (`ground`, shore lift applied) lies under the lake drawn there (`lakeLevel`, NaN when none), 0 from
 *  the shore height up — dry land, and every point no lake reaches. There the river only deepens the
 *  lakebed (its bank rim stood a levee in the water between the river and the lake), its surface is the
 *  lake's level and its bed paint yields to the lake's. The ramp lies wholly ABOVE the level, so ground
 *  under the water stays under it and the river's water never stands on the dry beach. Continuous: a
 *  lake is drawn beside land only where the shore lift already holds the ground at the shore height. */
export const riverMouthShare = (ground: number, lakeLevel: number): number =>
  Number.isNaN(lakeLevel) ? 0 : 1 - smoothstep(lakeLevel, lakeLevel + SHORE_RISE, ground);
const lakeLevelCache = new Map<string, number>();
const lakeCellLevel = (cell: VoronoiCell, zone: Zone): number => {
  const key = `${cell.ix},${cell.iz}`;
  let level = lakeLevelCache.get(key);
  if (level === undefined) {
    if (lakeLevelCache.size > 4096) dropOldestHalf(lakeLevelCache);
    const site = unwarp(cell.point.x, cell.point.z);
    level = terrainNoise(zone.baseNoise, site.x, site.z) - LAKE_SURFACE_BELOW_BASE;
    lakeLevelCache.set(key, level);
  }
  return level;
};
/** Water level at a warped point, or NaN when no water cell is within reach. */
export const lakeLevelAt = (warped: PointXZ, grid: VoronoiCell[]): number => {
  const reach = domainConfig!.gridSize * LAKE_LEVEL_REACH_CELLS;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    const zone = cell.element as Zone;
    if (!zone.biome.water) continue;
    const d = Math.hypot(warped.x - cell.point.x, warped.z - cell.point.z);
    if (d >= reach) continue;
    const w = (1 - d / reach) ** 2;
    sum += w * lakeCellLevel(cell, zone);
    weight += w;
  }
  return weight > 0 ? sum / weight : NaN;
};

/** The lake surface at the point of the last wall pass (NaN where no lake is drawn), and the shore
 *  clamp inputs shoreLift reads: land within SHORE_CLAMP_FULL of a water wall is lifted onto the
 *  shore height, fading back to its own relief over SHORE_CLAMP_FADE, so no land beside a lake lies
 *  under its level (a wall of water seen from the land). */
export const lakeSurface = (warped: PointXZ, ctx: BiomeContext, own: Zone): number => {
  shoreLevel = NaN;
  shoreDWater = Infinity;
  bowlFloor = NaN;
  if (own.biome.water) {
    const level = lakeLevelAt(warped, ctx.grid);
    if (zoneFinal[own.index] < 1 && !Number.isNaN(level)) {
      const presence = sstep01(zoneMinDist[own.index] / own.heightPresenceWidth);
      bowlFloor = level + SHORE_RISE - (own.biome.water.depth + SHORE_RISE) * presence;
    }
    return level;
  }
  let waterInReach = false;
  let dWater = Infinity;
  for (let i = 0; i < zones.length; i++) {
    if (!zones[i].biome.water) continue;
    if (zoneFinal[i] >= ZONE_WEIGHT_EPS) waterInReach = true;
    if (zoneMinDist[i] < dWater) dWater = zoneMinDist[i];
  }
  if (dWater >= SHORE_CLAMP_FULL + SHORE_CLAMP_FADE) return NaN;
  const level = lakeLevelAt(warped, ctx.grid);
  if (Number.isNaN(level)) return NaN;
  shoreLevel = level;
  shoreDWater = dWater;
  return waterInReach ? level : NaN;
};

export const clearLakeCaches = (): void => lakeLevelCache.clear();
