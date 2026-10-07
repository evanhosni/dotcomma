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
import { simplex2, terrainNoise, unwarp } from "./noise";
import type { BiomeContext, RiverParams, VoronoiCell, Zone } from "./types";
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
/** How far the level's kernel reaches the point (lakeLevelAt's weight): the lift fades out with it
 *  (SHORE_LEVEL_FADE_WEIGHT), since past the last water site's support no level exists. */
let shoreFade = 1;
/** Below this kernel weight (one site 600u off) the shore lift fades out: land within the clamp of a
 *  water wall but beyond every water site's reach lost its whole lift at once — a 33u cliff at (-523, 277). */
const SHORE_LEVEL_FADE_WEIGHT = 0.04;
let lastLevelWeight = 0;
/** In a water zone where a neighbor still has weight: the bowl's own height, which the blend may
 *  not dip under. On the wall that is the shore height the land side is lifted onto, so the two
 *  sides meet: without it a lower neighbor's share (desert salt beside the ocean) left the lake
 *  side up to 5u under the lifted land (a step along the waterline, census). */
let bowlFloor = NaN;

/** Sea-floor relief: hummocks on the lake BED (warped coords), grown in with presence² so the shore
 *  and the wall (presence 0) stay exactly as they were. Peaks stay ≥ 20u under a 26u lake's level. */
const LAKE_BED_BUMP_HEIGHT = 3.5;
const LAKE_BED_BUMP_SCALE = 70;
export const lakeBedBumps = (warped: PointXZ, presence: number): number => {
  if (presence <= 0) return 0;
  const n =
    simplex2(warped.x / LAKE_BED_BUMP_SCALE, warped.z / LAKE_BED_BUMP_SCALE) * 0.65 +
    simplex2(warped.x / (LAKE_BED_BUMP_SCALE * 0.3) + 31.7, warped.z / (LAKE_BED_BUMP_SCALE * 0.3) - 12.3) * 0.35;
  return n * LAKE_BED_BUMP_HEIGHT * presence * presence;
};

/** A lake zone's own bowl at full lift: the shore SHORE_RISE above the level at its wall, `depth` under it one width in. */
export const lakeBowlHeight = (level: number, depth: number, presence: number, warped: PointXZ): number =>
  level + SHORE_RISE - (depth + SHORE_RISE) * presence + lakeBedBumps(warped, presence);

export const shoreLift = (h: number): number => {
  if (!Number.isNaN(bowlFloor)) return h < bowlFloor ? bowlFloor : h;
  if (Number.isNaN(shoreLevel)) return h;
  const shore = shoreLevel + SHORE_RISE;
  if (!(h < shore)) return h;
  const lift = 1 - smoothstep(SHORE_CLAMP_FULL, SHORE_CLAMP_FULL + SHORE_CLAMP_FADE, shoreDWater);
  return h + (shore - h) * (shoreFade === 1 ? lift : lift * shoreFade);
};
/** The last lakeSurface's shore inputs: the lake level, the distance to its nearest water wall
 *  (NaN / Infinity where no lake is within the clamp's reach, or the point is IN the water) and how far
 *  the level reaches it (1, fading to 0 where the level's support ends). */
export const lastShore = (): { level: number; dWater: number; fade: number } => ({ level: shoreLevel, dWater: shoreDWater, fade: shoreFade });
/** The last lakeSurface's point's SIGNED distance to its nearest water wall: + on land, − in a water zone,
 *  clamped to ±SHORE_REACH — past it no wall is measured (land) or every wall is far (water), so the
 *  clamp keeps it 1-Lipschitz for a river piece to interpolate between its ends. */
export const SHORE_REACH = SHORE_CLAMP_FULL + SHORE_CLAMP_FADE;
export const lastShoreDistance = (): number => Math.max(-SHORE_REACH, Math.min(SHORE_REACH, Number.isNaN(ownWaterLevel) ? shoreDWater : -ownWaterDist));

/** The shore state lakeSurface leaves (saveShore / restoreShore: riverNetwork's gorgeRise). */
export const saveShore = (): number[] => [shoreLevel, shoreDWater, shoreFade, lastLevelWeight, bowlFloor, ownWaterLevel, ownWaterDist];
export const restoreShore = (s: number[]): void => {
  [shoreLevel, shoreDWater, shoreFade, lastLevelWeight, bowlFloor, ownWaterLevel, ownWaterDist] = s;
};

/** The last lakeSurface's level where its point is IN a water zone (NaN elsewhere). */
let ownWaterLevel = NaN;
/** …and its distance to its own zone's nearest wall (the shore). */
let ownWaterDist = Infinity;
/** A river's surface at the last lakeSurface's point (its wall pass still current), held up to the
 *  lake's level by the weight of the CRISP land there (the city): its side of the wall draws no lake (its
 *  wall pass gives the water no weight), so a surface under the level — interpolated toward a piece end
 *  in the lake, sunk there under the lakebed — showed as river water, carved, 14u under the lake beside
 *  it (3064, 1310). On the land side the hold fades out with the shore lift; on the lake side it is the
 *  crisp zone's weight, 1 at the wall from both sides, so the two meet there. Elsewhere unchanged. */
export const riverSurfaceBesideCrispShore = (surface: number): number => {
  let crisp = 0;
  for (let i = 0; i < zones.length; i++) if (zones[i].crisp && !zones[i].biome.water) crisp += zoneFinal[i];
  if (!(crisp > 0)) return surface;
  let level = ownWaterLevel;
  let hold = crisp;
  if (Number.isNaN(level)) {
    level = shoreLevel;
    hold = crisp * (1 - smoothstep(SHORE_CLAMP_FULL, SHORE_CLAMP_FULL + SHORE_CLAMP_FADE, shoreDWater)) * shoreFade;
  }
  return surface < level ? surface + (level - surface) * hold : surface;
};

/** How much of a river's channel rules at a point are a MOUTH's: 1 where the ground before the river
 *  (`ground`, shore lift applied) lies under the lake drawn there (`lakeLevel`, NaN when none), 0 from
 *  the shore height up — dry land, and every point no lake reaches. There the river only deepens the
 *  lakebed (its bank rim stood a levee in the water between the river and the lake), its surface is the
 *  lake's level and its bed paint yields to the lake's. The ramp lies wholly ABOVE the level, so ground
 *  under the water stays under it and the river's water never stands on the dry beach. Continuous: a
 *  lake is drawn beside land only where the shore lift already holds the ground at the shore height. */
export const riverMouthShare = (ground: number, lakeLevel: number): number =>
  Number.isNaN(lakeLevel) ? 0 : 1 - smoothstep(lakeLevel, lakeLevel + SHORE_RISE, ground);
/** A river BESIDE a lake (riverLakeMerge): the dry land between them goes under the water when the
 *  gap between the river's water band and the lake's wall is at most MERGE_GAP_FULL + half the band
 *  (real units), none from MERGE_GAP_FADE more; it is sunk to the river channel's own floor (mergeFloor). */
const MERGE_GAP_FULL = 40;
const MERGE_GAP_FADE = 80;
/** The band's share of that allowance stops growing here (a pond end's band reaches ~240u). */
const MERGE_BAND_ALLOWANCE_MAX = 120;
/** Ground this far over the shore height merges whole, from this plus MERGE_HIGH_FADE none: a real
 *  ridge between river and lake (dunes, 30–80u) stays land. */
const MERGE_HIGH_FULL = 10;
const MERGE_HIGH_FADE = 10;
/** The river's surface must not stand over the lake's level by more than this (fading over the second),
 *  or the two waters would meet at a step: a river beside a lake is eased onto it (riverPieceEndSurface).
 *  UNDER the level (a mouth's surface sinks into the lakebed) nothing is gated: the merged water is the
 *  level there (a gate on it cut the share within 6u where a mouth's surface sinks: a 10u cliff). */
const MERGE_SURFACE_TOLERANCE = 0.25;
const MERGE_SURFACE_FADE = 0.5;
/** Inside the lake the share fades out between these depths past its wall, where the bowl already
 *  lies deeper than the floor (the lake's 90u blend: 14u under the level 50u in, 23u 70u in). */
const MERGE_LAKE_IN = 60;
const MERGE_LAKE_OUT = 100;
/** A sliver between the two waters whatever its shape (the corner where a river turns into the lake,
 *  where the straight-way test below does not hold): the land within this of both the river's water
 *  band and the lake's wall merges, none from MERGE_CORNER_FADE more. */
const MERGE_CORNER = 25;
const MERGE_CORNER_FADE = 50;
/** The level riverLakeMerge last merged into (NaN where its share is 0). */
let mergeLevel = NaN;
export const lastMergeLevel = (): number => mergeLevel;
let mergeDepth = 0;
/** The merged ground's floor: the river channel's own bottom (`depth·√factor` under the surface it is
 *  eased onto), so the water over it is as deep and as opaque as the river's and the lake's — a shallow
 *  floor showed the old levee's snow and sand through the water's 2.5u alpha fade as a pale sandbar.
 *  The lake's bowl, deeper past its beach, wins the min toward the lake. */
export const mergeFloor = (): number => mergeLevel - mergeDepth;

/** How close a river's centerline (signed water-wall distance `centerShore`, width `factor`) is to a
 *  lake for the land between to merge (riverLakeMerge): 1 to 0 over the gap's fade. `wide`: the
 *  surface's own easing onto the level (riverSurface.ts), which is whole wherever the land may merge. */
export const riverLakeCloseness = (centerShore: number, factor: number, river: RiverParams, wide: boolean): number => {
  const band = (river.halfWidth + river.bank * 0.5) * factor;
  const full = MERGE_GAP_FULL + Math.min(band, MERGE_BAND_ALLOWANCE_MAX) * 0.5 + (wide ? MERGE_GAP_FADE : 0);
  return 1 - smoothstep(full, full + MERGE_GAP_FADE, centerShore - band);
};

/** How much of a point at the last lakeSurface's point is merged into the lake beside a river: 1 on
 *  the land BETWEEN a river and a lake close beside it (and that river's lake-side channel and the
 *  lake's own beach there), 0 on the river's far side, away from such a river, on high ground and
 *  past the lake's beach. `ground` is the terrain before the river (shore lift applied), `distance` /
 *  `factor` / `surface` the river field there, `centerShore` / `centerLevel` the signed water-wall
 *  distance and the lake level at its centerline (riverSample.shore / level): the surface is judged
 *  against the level it was eased onto there (the lake's own level tilts ~0.6u over 80u in places). Between-ness is the triangle inequality: a point on the straight
 *  way from the centerline to the lake has river distance + its own wall distance = the centerline's
 *  wall distance; on the far bank the excess is twice its offset. Every factor is continuous. */
export const riverLakeMerge = (ground: number, distance: number, factor: number, surface: number, centerShore: number, centerLevel: number, river: RiverParams): number => {
  mergeLevel = NaN;
  const inWater = !Number.isNaN(ownWaterLevel);
  const level = inWater ? ownWaterLevel : shoreLevel;
  const s = inWater ? -ownWaterDist : shoreDWater;
  if (Number.isNaN(level) || !(s < Infinity) || !(centerShore < Infinity)) return 0;
  let m = riverLakeCloseness(centerShore, factor, river, false);
  if (m <= 0) return 0;
  const half = river.halfWidth * factor;
  const straightWay = 1 - smoothstep(0.6 * half, 1.5 * half, distance * factor + s - centerShore);
  const band = (river.halfWidth + river.bank * 0.5) * factor;
  const corner = 1 - smoothstep(MERGE_CORNER, MERGE_CORNER + MERGE_CORNER_FADE, Math.max(0, distance * factor - band) + Math.max(0, s));
  m *= Math.max(straightWay, corner);
  if (m <= 0) return 0;
  m *= 1 - smoothstep(MERGE_SURFACE_TOLERANCE, MERGE_SURFACE_TOLERANCE + MERGE_SURFACE_FADE, surface - centerLevel);
  m *= 1 - smoothstep(MERGE_HIGH_FULL, MERGE_HIGH_FULL + MERGE_HIGH_FADE, ground - level - SHORE_RISE);
  if (inWater) m *= 1 - smoothstep(MERGE_LAKE_IN, MERGE_LAKE_OUT, -s);
  else if (shoreFade < 1) m *= shoreFade;
  if (m > 0) {
    mergeLevel = level;
    mergeDepth = river.depth * Math.sqrt(factor);
  }
  return m;
};

// Numeric keys (cell ix, iz): a key string per water cell in reach was most of a shore vertex's level lookup.
const lakeLevelCache = new Map<number, number>();
const lakeCellLevel = (cell: VoronoiCell, zone: Zone): number => {
  const key = cell.ix * 4194304 + cell.iz;
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
  // A vertex asks twice for its own point (a water zone's height, then lakeSurface): the last answer.
  if (warped.x === lastLevelX && warped.z === lastLevelZ && grid === lastLevelGrid) {
    lastLevelWeight = lastLevelW;
    return lastLevel;
  }
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
  lastLevelWeight = weight;
  lastLevelX = warped.x;
  lastLevelZ = warped.z;
  lastLevelGrid = grid;
  lastLevelW = weight;
  lastLevel = weight > 0 ? sum / weight : NaN;
  return lastLevel;
};
let lastLevelX = NaN;
let lastLevelZ = NaN;
let lastLevelGrid: VoronoiCell[] | null = null;
let lastLevelW = 0;
let lastLevel = NaN;

/** The lake surface at the point of the last wall pass (NaN where no lake is drawn), and the shore
 *  clamp inputs shoreLift reads: land within SHORE_CLAMP_FULL of a water wall is lifted onto the
 *  shore height, fading back to its own relief over SHORE_CLAMP_FADE, so no land beside a lake lies
 *  under its level (a wall of water seen from the land). */
export const lakeSurface = (warped: PointXZ, ctx: BiomeContext, own: Zone): number => {
  shoreLevel = NaN;
  shoreDWater = Infinity;
  shoreFade = 1;
  bowlFloor = NaN;
  ownWaterLevel = NaN;
  ownWaterDist = Infinity;
  if (own.biome.water) {
    const level = lakeLevelAt(warped, ctx.grid);
    ownWaterLevel = level;
    ownWaterDist = zoneMinDist[own.index];
    if (zoneFinal[own.index] < 1 && !Number.isNaN(level)) {
      const presence = sstep01(zoneMinDist[own.index] / own.heightPresenceWidth);
      bowlFloor = lakeBowlHeight(level, own.biome.water.depth, presence, warped);
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
  if (lastLevelWeight < SHORE_LEVEL_FADE_WEIGHT) shoreFade = smoothstep(0, SHORE_LEVEL_FADE_WEIGHT, lastLevelWeight);
  return waterInReach ? level : NaN;
};

export const clearLakeCaches = (): void => {
  lakeLevelCache.clear();
  lastLevelGrid = null;
};
