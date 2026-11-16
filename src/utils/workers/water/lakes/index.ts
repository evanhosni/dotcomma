/**
 * AREA WATER: LAKES and their SHORES (world/water/README.md "Lakes"; composed with the other bodies in
 * ../index.ts, joined with the rivers in ../joins/).
 *
 * A lake cell's level is the region base at its SITE, `levelBelow` under it so the shore (where the bowl
 * meets the base) sits above the water. The surface at a point blends the levels of every lake cell
 * within LAKE_LEVEL_REACH_CELLS by a compact kernel: one level per cell would stand 1–3u walls of water on
 * the wall between two lake cells of one body. The 5×5 grid always holds every cell within the reach of a
 * point in its centre cell, so the kernel's support never changes with the grid window (no step at
 * grid-cell borders). The surface is then held under the NATURAL ground of the land beside it (landDeficitAt;
 * Evan: lower the water, never raise the bank — a salt flat 55u under the lake beside it stood under a lifted
 * shelf and a 250u drop), and land near a lake is lifted onto its shore (shoreLift), so none lies under it.
 * Three-free.
 */

import { smoothstep } from "../../../math";
import type { PointXZ } from "../../../math/types";
import { dropOldestHalf } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import { simplex2, terrainNoise, unwarp } from "../../noise";
import { biomeSiteAt, getBiomeContext } from "../../voronoi";
import { naturalGroundAt } from "../utils";
import type { BiomeContext, VoronoiCell, Zone } from "../../types";
import { ZONE_WEIGHT_EPS, sstep01, zoneFinal, zoneMinDist, zones } from "../../zoneBlend";
import { SHORE_RISE } from "../constants";
import { LAKE_DEFAULTS, type LakeParams, isLakeBiome, lakeBiomeIds, lakeOf } from "./params";

const LAKE_LEVEL_REACH_CELLS = 1.5;
/** Below this kernel weight (one site 600u off) the shore lift fades out: land within the hold of a lake
 *  wall but beyond every lake site's reach lost its whole lift at once — a 33u cliff at (-523, 277). */
const SHORE_LEVEL_FADE_WEIGHT = 0.04;

/**
 * The SHORE at the point of the last lakeSurface — what shoreLift lifts the land by (also through
 * blendedTerrainAt, so a river surface or a road grade sampled beside a lake is lifted like the terrain
 * around it) and what a river reads of the lake beside it (../joins/, rivers/surface.ts).
 *  - `level`/`dWater`: on land, the lake level and the distance to its nearest wall (NaN / Infinity where
 *    no lake is within its shore's reach); `hold`/`fade`: that lake's shore lift, `approach` how far a
 *    river eases onto it (LakeParams; in a lake zone, its own).
 *  - `support`: how far the level's kernel reaches the point (1, fading to 0 where it ends).
 *  - `ownLevel`/`ownDist`: in a lake zone, its level and the distance to its own nearest wall (NaN /
 *    Infinity elsewhere).
 *  - `bowlFloor`: in a lake zone where a neighbour still weighs, the bowl's own height, which the blend
 *    may not dip under. On the wall that is the shore the land side is lifted onto, so the two sides meet:
 *    without it a lower neighbour's share (desert salt beside the ocean) left the lake side up to 5u under
 *    the lifted land (a step along the waterline, census).
 */
export const lakeShore = {
  level: NaN,
  dWater: Infinity,
  hold: LAKE_DEFAULTS.shoreHold,
  fade: LAKE_DEFAULTS.shoreFade,
  approach: LAKE_DEFAULTS.riverApproach,
  support: 1,
  ownLevel: NaN,
  ownDist: Infinity,
  bowlFloor: NaN,
};
let levelWeight = 0;

/** The shore state lakeSurface leaves, for an evaluation that must put the vertex in progress back. */
export const saveShore = (): number[] => [
  lakeShore.level,
  lakeShore.dWater,
  lakeShore.hold,
  lakeShore.fade,
  lakeShore.approach,
  lakeShore.support,
  lakeShore.ownLevel,
  lakeShore.ownDist,
  lakeShore.bowlFloor,
  levelWeight,
];
export const restoreShore = (s: number[]): void => {
  [lakeShore.level, lakeShore.dWater, lakeShore.hold, lakeShore.fade, lakeShore.approach, lakeShore.support, lakeShore.ownLevel, lakeShore.ownDist, lakeShore.bowlFloor, levelWeight] = s;
};

/** Hummocks on a lake's BED (warped coords), grown in with presence² so the shore and the wall (presence
 *  0) stay exactly as they were. */
export const lakeBedBumps = (warped: PointXZ, presence: number, lake: LakeParams): number => {
  if (presence <= 0) return 0;
  const scale = lake.bedBumpScale;
  const height = lake.depth * lake.bedBumps;
  const n = simplex2(warped.x / scale, warped.z / scale) * 0.65 + simplex2(warped.x / (scale * 0.3) + 31.7, warped.z / (scale * 0.3) - 12.3) * 0.35;
  return n * height * presence * presence;
};

/** A lake zone's own bowl at full lift: the shore SHORE_RISE above the level at its wall, `depth` under it one width in. */
export const lakeBowlHeight = (level: number, lake: LakeParams, presence: number, warped: PointXZ): number =>
  level + SHORE_RISE - (lake.depth + SHORE_RISE) * presence + lakeBedBumps(warped, presence, lake);

/** How much of the shore lift holds the last lakeSurface's land point (0 in the water or out of reach). */
export const shoreLiftShare = (): number =>
  Number.isNaN(lakeShore.level) ? 0 : (1 - smoothstep(lakeShore.hold, lakeShore.hold + lakeShore.fade, lakeShore.dWater)) * lakeShore.support;

/** `h` lifted onto the shore of the lake beside the last lakeSurface's point. */
export const shoreLift = (h: number): number => {
  if (!Number.isNaN(lakeShore.bowlFloor)) return h < lakeShore.bowlFloor ? lakeShore.bowlFloor : h;
  if (Number.isNaN(lakeShore.level)) return h;
  const shore = lakeShore.level + SHORE_RISE;
  if (!(h < shore)) return h;
  const lift = 1 - smoothstep(lakeShore.hold, lakeShore.hold + lakeShore.fade, lakeShore.dWater);
  return h + (shore - h) * (lakeShore.support === 1 ? lift : lift * lakeShore.support);
};

/** The farthest any lake's shore reaches past its wall (real units): past it, no point reads a lake.
 *  Found once per init (NaN: not yet). */
let reach = NaN;
export const shoreReach = (): number => {
  if (Number.isNaN(reach)) {
    reach = LAKE_DEFAULTS.shoreHold + LAKE_DEFAULTS.shoreFade;
    const ids = lakeBiomeIds();
    for (const region of domainConfig?.regions ?? []) {
      for (const biome of region.biomes) {
        const lake = ids.includes(biome.id) ? lakeOf(biome) : null;
        if (lake) reach = Math.max(reach, lake.shoreHold + lake.shoreFade);
      }
    }
  }
  return reach;
};

/** The last lakeSurface's point's SIGNED distance to its nearest lake wall: + on land, − in a lake zone,
 *  clamped to ±shoreReach() (past it no wall is measured), so a river piece can interpolate it. */
export const lastShoreDistance = (): number => {
  const r = shoreReach();
  return Math.max(-r, Math.min(r, Number.isNaN(lakeShore.ownLevel) ? lakeShore.dWater : -lakeShore.ownDist));
};
/** The last lakeSurface's lake level, on land or in the water (NaN: no lake in reach). */
export const lastLakeLevel = (): number => (Number.isNaN(lakeShore.ownLevel) ? lakeShore.level : lakeShore.ownLevel);

/** THE LAND ROUND A LAKE: the level never stands over the natural ground of the land beside it. Each lake
 *  cell's walls with a land cell (sites within PAIR_CELLS) are sampled along them (WALL_ALONG) and into the
 *  land (WALL_PAST, real units, through the shore's hold and fade); where the natural ground there less the
 *  lake's `levelBelowLand` lies under the cells' level at the wall, the difference is a DEFICIT the water
 *  comes down by — whole within FLOOR_HOLD of the sample, easing out linearly at the lake's `landGrade`
 *  (over at most FLOOR_EASE_MAX) — and the level drops by the largest deficit in reach (lakeLevelAt). So the
 *  water comes down only near low land, tilting at most `landGrade`, and stays where it was along every
 *  higher shore: lowering each cell to its lowest land brought a whole sea down up to 106u beside one salt
 *  flat. A pure function of position, continuous by construction (each deficit eases to 0): a grid square
 *  reads every sample reaching it, from the lake cells within FLOOR_CELLS. */
const PAIR_CELLS = 2.2;
const WALL_ALONG = [-150, 0, 150];
const WALL_PAST = [40, 160, 320];
const FLOOR_HOLD = 200;
const FLOOR_EASE_MAX = 1500;
const FLOOR_CELLS = 6;
const SAMPLE = 4;
/** While > 0 the land is being sampled: the level read there is its cells' alone (no recursion). */
let sampling = 0;
const cellKey = (ix: number, iz: number): number => ix * 4194304 + iz;
/** Per lake cell, its wall samples with a deficit: x, z (warped), the deficit, the ease's length. */
const wallSampleCache = new Map<number, Float64Array>();
const wallSamplesOf = (ix: number, iz: number, lake: LakeParams): Float64Array => {
  const key = cellKey(ix, iz);
  let out = wallSampleCache.get(key);
  if (out) return out;
  const samples: number[] = [];
  const gs = domainConfig!.gridSize;
  const site = biomeSiteAt(ix, iz);
  sampling++;
  try {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const land = biomeSiteAt(ix + i, iz + j);
        if (isLakeBiome(land.zone.biome)) continue;
        const span = Math.hypot(land.x - site.x, land.z - site.z);
        if (!(span > 0) || span > PAIR_CELLS * gs) continue;
        const ux = (land.x - site.x) / span;
        const uz = (land.z - site.z) / span;
        const mx = (site.x + land.x) / 2;
        const mz = (site.z + land.z) / 2;
        const wall = getBiomeContext({ x: mx, z: mz });
        const level = lakeLevelAt(wall.warped, wall.grid);
        if (Number.isNaN(level)) continue;
        for (const along of WALL_ALONG) {
          for (const past of WALL_PAST) {
            const x = mx + ux * past - uz * along;
            const z = mz + uz * past + ux * along;
            const deficit = level - (naturalGroundAt(x, z) - lake.levelBelowLand);
            if (deficit > 0) samples.push(x, z, deficit, Math.min(FLOOR_EASE_MAX, deficit / lake.landGrade));
          }
        }
      }
    }
  } finally {
    sampling--;
  }
  out = Float64Array.from(samples);
  if (wallSampleCache.size > 4096) dropOldestHalf(wallSampleCache);
  wallSampleCache.set(key, out);
  return out;
};
/** Per grid square, the wall samples whose deficit reaches it. */
const floorSampleCache = new Map<number, Float64Array>();
const floorSamplesIn = (cx: number, cz: number): Float64Array => {
  const key = cellKey(cx, cz);
  let out = floorSampleCache.get(key);
  if (out) return out;
  const gs = domainConfig!.gridSize;
  const x0 = cx * gs;
  const z0 = cz * gs;
  const kept: number[] = [];
  for (let i = -FLOOR_CELLS; i <= FLOOR_CELLS; i++) {
    for (let j = -FLOOR_CELLS; j <= FLOOR_CELLS; j++) {
      const lake = lakeOf(biomeSiteAt(cx + i, cz + j).zone.biome);
      if (!lake) continue;
      const samples = wallSamplesOf(cx + i, cz + j, lake);
      for (let k = 0; k < samples.length; k += SAMPLE) {
        const dx = Math.max(x0 - samples[k], 0, samples[k] - x0 - gs);
        const dz = Math.max(z0 - samples[k + 1], 0, samples[k + 1] - z0 - gs);
        const reach = FLOOR_HOLD + samples[k + 3];
        if (dx * dx + dz * dz < reach * reach) kept.push(samples[k], samples[k + 1], samples[k + 2], samples[k + 3]);
      }
    }
  }
  out = Float64Array.from(kept);
  if (floorSampleCache.size > 4096) dropOldestHalf(floorSampleCache);
  floorSampleCache.set(key, out);
  return out;
};
/** How far the land beside it brings a lake's level down at a warped point (0: none). */
const landDeficitAt = (wx: number, wz: number): number => {
  const gs = domainConfig!.gridSize;
  const samples = floorSamplesIn(Math.floor(wx / gs), Math.floor(wz / gs));
  let drop = 0;
  for (let k = 0; k < samples.length; k += SAMPLE) {
    if (samples[k + 2] <= drop) continue;
    const d = Math.hypot(wx - samples[k], wz - samples[k + 1]) - FLOOR_HOLD;
    const v = d <= 0 ? samples[k + 2] : samples[k + 2] * (1 - d / samples[k + 3]);
    if (v > drop) drop = v;
  }
  return drop;
};

// Numeric keys (cell ix, iz): a key string per lake cell in reach was most of a shore vertex's level lookup.
const lakeLevelCache = new Map<number, number>();
const lakeCellLevel = (cell: VoronoiCell, zone: Zone): number => {
  const key = cellKey(cell.ix, cell.iz);
  let level = lakeLevelCache.get(key);
  if (level === undefined) {
    if (lakeLevelCache.size > 4096) dropOldestHalf(lakeLevelCache);
    const site = unwarp(cell.point.x, cell.point.z);
    level = terrainNoise(zone.baseNoise, site.x, site.z) - lakeOf(zone.biome)!.levelBelow;
    lakeLevelCache.set(key, level);
  }
  return level;
};
let lastLevelX = NaN;
let lastLevelZ = NaN;
let lastLevelGrid: VoronoiCell[] | null = null;
let lastLevelW = 0;
let lastLevel = NaN;
/** The lake level at a warped point, or NaN when no lake cell is within reach: its cells' levels blended,
 *  brought down by the land beside it (landDeficitAt). */
export const lakeLevelAt = (warped: PointXZ, grid: VoronoiCell[]): number => {
  // A vertex asks twice for its own point (a lake zone's height, then lakeSurface): the last answer.
  if (sampling === 0 && warped.x === lastLevelX && warped.z === lastLevelZ && grid === lastLevelGrid) {
    levelWeight = lastLevelW;
    return lastLevel;
  }
  const reachCells = domainConfig!.gridSize * LAKE_LEVEL_REACH_CELLS;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    const zone = cell.element as Zone;
    if (!isLakeBiome(zone.biome)) continue;
    const d = Math.hypot(warped.x - cell.point.x, warped.z - cell.point.z);
    if (d >= reachCells) continue;
    const w = (1 - d / reachCells) ** 2;
    sum += w * lakeCellLevel(cell, zone);
    weight += w;
  }
  levelWeight = weight;
  // Held under the land beside it (not while that land is being sampled).
  const level = !(weight > 0) ? NaN : sampling > 0 ? sum / weight : sum / weight - landDeficitAt(warped.x, warped.z);
  if (sampling > 0) return level;
  lastLevelX = warped.x;
  lastLevelZ = warped.z;
  lastLevelGrid = grid;
  lastLevelW = weight;
  lastLevel = level;
  return level;
};

/** The lake surface at the point of the last wall pass (NaN where no lake is drawn), and the shore
 *  (lakeShore) shoreLift reads: land within its lake's `shoreHold` of a lake wall is lifted onto the
 *  shore height, fading back to its own relief over `shoreFade`, so no land beside a lake lies under its
 *  level (a wall of water seen from the land). */
export const lakeSurface = (warped: PointXZ, ctx: BiomeContext, own: Zone): number => {
  lakeShore.level = NaN;
  lakeShore.dWater = Infinity;
  lakeShore.support = 1;
  lakeShore.bowlFloor = NaN;
  lakeShore.ownLevel = NaN;
  lakeShore.ownDist = Infinity;
  const ownLake = lakeOf(own.biome);
  if (ownLake) {
    const level = lakeLevelAt(warped, ctx.grid);
    lakeShore.ownLevel = level;
    lakeShore.ownDist = zoneMinDist[own.index];
    lakeShore.approach = ownLake.riverApproach;
    if (zoneFinal[own.index] < 1 && !Number.isNaN(level)) {
      const presence = sstep01(zoneMinDist[own.index] / own.heightPresenceWidth);
      lakeShore.bowlFloor = lakeBowlHeight(level, ownLake, presence, warped);
    }
    return level;
  }
  let lakeInReach = false;
  let dWater = Infinity;
  let nearest: LakeParams | null = null;
  for (let i = 0; i < zones.length; i++) {
    const lake = lakeOf(zones[i].biome);
    if (!lake) continue;
    if (zoneFinal[i] >= ZONE_WEIGHT_EPS) lakeInReach = true;
    if (zoneMinDist[i] < dWater) {
      dWater = zoneMinDist[i];
      nearest = lake;
    }
  }
  if (!nearest || dWater >= nearest.shoreHold + nearest.shoreFade) return NaN;
  const level = lakeLevelAt(warped, ctx.grid);
  if (Number.isNaN(level)) return NaN;
  lakeShore.level = level;
  lakeShore.dWater = dWater;
  lakeShore.hold = nearest.shoreHold;
  lakeShore.fade = nearest.shoreFade;
  lakeShore.approach = nearest.riverApproach;
  if (levelWeight < SHORE_LEVEL_FADE_WEIGHT) lakeShore.support = smoothstep(0, SHORE_LEVEL_FADE_WEIGHT, levelWeight);
  return lakeInReach ? level : NaN;
};

export const clearLakeCaches = (): void => {
  reach = NaN;
  lakeLevelCache.clear();
  wallSampleCache.clear();
  floorSampleCache.clear();
  lastLevelGrid = null;
};
