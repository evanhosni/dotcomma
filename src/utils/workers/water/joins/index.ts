/**
 * Where a river meets a LAKE (step 4's JOINS, ./index.ts resolveWater; world/water/README.md): the two
 * bodies know nothing of each other, and everything that joins them is here, read off the lake's shore at
 * the vertex (lakes/ lakeShore) and the river's field.
 *  - A MOUTH: over ground already under the lake's level the river only deepens the lakebed.
 *  - QUAYS BY A LAKE: where a biome keeping its own banks (<Quays/>) stands beside a lake, a river there
 *    is held up to its level.
 *  - A MERGE: a river running close beside a lake becomes one water with it.
 *  - WIDENING: rivers grow wider toward a region of lakes (<Lake riverWidening>).
 * Three-free.
 */

import { smoothstep } from "../../../math";
import { domainConfig } from "../../computeConfig";
import type { RiverParams, SerializedRegion } from "../../types";
import { regionSiteAt } from "../../voronoi";
import { zoneFinal, zones } from "../../zoneBlend";
import { SHORE_RISE } from "../constants";
import { lakeShore, shoreLiftShare } from "../lakes";
import { lakeOf } from "../lakes/params";
import { keepsOwnBanks } from "../params";

/** How much of a river's channel at a point is a MOUTH: 1 where the ground before the river lies under
 *  the lake drawn there (`lakeLevel`, NaN: none), 0 from SHORE_RISE above it. There the river only
 *  deepens the lakebed — no rim, the lake's level, the lake's paint. The ramp lies wholly above the
 *  level, so ground under the water stays under it and dry land is carved as ever. */
export const riverMouthShare = (ground: number, lakeLevel: number): number =>
  Number.isNaN(lakeLevel) ? 0 : 1 - smoothstep(lakeLevel, lakeLevel + SHORE_RISE, ground);

let mouth = 0;
/** How much of the last drawnRiverWater's river is a MOUTH. */
export const lastMouthShare = (): number => mouth;

/** A river's surface (`held`: already held beside quays, holdRiverBesideQuays) as drawn over
 *  `ground` (the terrain before the channel) beside a lake at `lakeLevel` (NaN: none): brought down onto
 *  the lake's level over a mouth. Step 4 and the decks' clearance (rivers/field.ts drawnRiverSurface) both
 *  draw it here. */
export const drawnRiverWater = (held: number, ground: number, lakeLevel: number): number => {
  mouth = riverMouthShare(ground, lakeLevel);
  return held > lakeLevel ? held + (lakeLevel - held) * mouth : held;
};

/** A river surface held up toward the lake's level by the weight of a biome keeping its own banks
 *  (<Quays/>) at the last lakeSurface's point. Such a biome walls its rivers on a crisp edge whose wall pass
 *  gives the lake beside it no weight, so a surface sinking toward a piece end in the lake showed as river
 *  water 14u under the lake beside it (3064, 1310). On land the hold fades out with the shore lift; on the
 *  lake side it is that biome's weight, 1 at the wall from both sides, so the two meet there. */
export const holdRiverBesideQuays = (surface: number): number => {
  let quays = 0;
  for (let i = 0; i < zones.length; i++) if (keepsOwnBanks(zones[i].biome)) quays += zoneFinal[i];
  if (!(quays > 0)) return surface;
  const inLake = !Number.isNaN(lakeShore.ownLevel);
  const level = inLake ? lakeShore.ownLevel : lakeShore.level;
  const hold = inLake ? quays : quays * shoreLiftShare();
  return surface < level ? surface + (level - surface) * hold : surface;
};

/** A river and a lake close beside it MERGE: the land between them goes under the lake (riverLakeMerge).
 *  The gap between the river's water band and the lake's wall merges whole up to MERGE_GAP + half the
 *  band (the band's share capped at MERGE_BAND_MAX), none from MERGE_GAP_FADE more. */
const MERGE_GAP = 40;
const MERGE_GAP_FADE = 80;
const MERGE_BAND_MAX = 120;
/** A corner sliver within MERGE_CORNER of both waters merges too, none from MERGE_CORNER_FADE more. */
const MERGE_CORNER = 25;
const MERGE_CORNER_FADE = 50;
/** Not over a real ridge: ground this far over the shore height merges whole, none from twice it. */
const MERGE_RIDGE = 10;
/** Not where the river stands this far over its centerline's level (fading over the second): the
 *  lake's own level tilts ~0.6u over 80u, so the vertex's level is the wrong reference. */
const MERGE_SURFACE_ABOVE = 0.25;
const MERGE_SURFACE_FADE = 0.5;
/** Inside the lake the merge fades out between these depths past its wall (the bowl is deeper there). */
const MERGE_LAKE_IN = 60;
const MERGE_LAKE_OUT = 100;

let mergeLevel = NaN;
let mergeDepth = 0;
/** The level riverLakeMerge last merged into (NaN where it merged nothing). */
export const lastMergeLevel = (): number => mergeLevel;
/** The merged ground's floor: the river channel's own bottom under that level (a shallow floor showed
 *  the old levee through the water's alpha fade as a pale sandbar). */
export const mergeFloor = (): number => mergeLevel - mergeDepth;

/** How close a river centerline at signed wall distance `centerShore` with width `factor` is to merging,
 *  1 → 0 over the gap's fade; `wide`: the river surface's easing onto the level (rivers/surface.ts), whole
 *  wherever the land may merge. */
export const riverLakeCloseness = (centerShore: number, factor: number, river: RiverParams, wide: boolean): number => {
  const band = (river.halfWidth + river.bank * 0.5) * factor;
  const full = MERGE_GAP + Math.min(band, MERGE_BAND_MAX) * 0.5 + (wide ? MERGE_GAP_FADE : 0);
  return 1 - smoothstep(full, full + MERGE_GAP_FADE, centerShore - band);
};

/** How much of the last lakeSurface's point merges into the lake beside a river: 1 on the land BETWEEN a
 *  river and a lake close beside it (and on that river's lake-side channel and the lake's beach there), 0
 *  on the far bank, away from such a river, on a ridge and deep in the lake. `ground` is the terrain
 *  before the river, `distance`/`factor`/`surface` the river field at the point, `centerShore`/
 *  `centerLevel` the signed wall distance and level at its centerline (riverSample.shore / level), `depth`
 *  the channel's depth scale. Between-ness is the triangle inequality: on the straight way from the
 *  centerline to the lake the river distance plus the point's own wall distance is the centerline's; on
 *  the far bank it exceeds it by twice the offset. */
export const riverLakeMerge = (
  ground: number,
  distance: number,
  factor: number,
  surface: number,
  centerShore: number,
  centerLevel: number,
  river: RiverParams,
  depth: number,
): number => {
  mergeLevel = NaN;
  const inLake = !Number.isNaN(lakeShore.ownLevel);
  const level = inLake ? lakeShore.ownLevel : lakeShore.level;
  const shore = inLake ? -lakeShore.ownDist : lakeShore.dWater;
  if (Number.isNaN(level) || !(shore < Infinity) || !(centerShore < Infinity)) return 0;
  let m = riverLakeCloseness(centerShore, factor, river, false);
  if (m <= 0) return 0;
  const half = river.halfWidth * factor;
  const band = (river.halfWidth + river.bank * 0.5) * factor;
  const straightWay = 1 - smoothstep(0.6 * half, 1.5 * half, distance * factor + shore - centerShore);
  const corner = 1 - smoothstep(MERGE_CORNER, MERGE_CORNER + MERGE_CORNER_FADE, Math.max(0, distance * factor - band) + Math.max(0, shore));
  m *= Math.max(straightWay, corner);
  m *= 1 - smoothstep(MERGE_SURFACE_ABOVE, MERGE_SURFACE_ABOVE + MERGE_SURFACE_FADE, surface - centerLevel);
  m *= 1 - smoothstep(MERGE_RIDGE, 2 * MERGE_RIDGE, ground - level - SHORE_RISE);
  m *= inLake ? 1 - smoothstep(MERGE_LAKE_IN, MERGE_LAKE_OUT, -shore) : lakeShore.support;
  if (m > 0) {
    mergeLevel = level;
    mergeDepth = river.depth * depth * Math.sqrt(factor);
  }
  return m;
};

/** Per region: each of its <Lake> biomes with its share of the region's biome roll; and the farthest any
 *  lake widens rivers (real units). Found once per init (empty: not yet). */
const lakesByRegion = new Map<SerializedRegion, { share: number; widening: number; reach: number }[]>();
let wideningReach = 0;
const regionLakes = (region: SerializedRegion): { share: number; widening: number; reach: number }[] => {
  if (lakesByRegion.size === 0) {
    wideningReach = 0;
    for (const r of domainConfig?.regions ?? []) {
      const total = r.biomes.reduce((sum, b) => sum + (b.weight ?? 1), 0);
      const lakes = [];
      for (const b of r.biomes) {
        const lake = lakeOf(b);
        if (!lake) continue;
        lakes.push({ share: (b.weight ?? 1) / total, widening: lake.riverWidening, reach: lake.riverWideningReach });
        wideningReach = Math.max(wideningReach, lake.riverWideningReach);
      }
      lakesByRegion.set(r, lakes);
    }
  }
  return lakesByRegion.get(region) ?? [];
};

/** How much wider a river junction at a warped point is toward the lakes near it: of every region site in
 *  reach, the most its lakes widen it — each <Lake> biome its `riverWidening` × its share of the region,
 *  fading out linearly by its `riverWideningReach` from the site. An all-lake region (the ocean) widens by
 *  its lakes' whole widening; a region with a lake among other biomes by that share of it. */
export const riverWideningAt = (x: number, z: number): number => {
  regionLakes(domainConfig!.regions[0]);
  if (!(wideningReach > 0)) return 0;
  const rgs = domainConfig!.regionGridSize;
  const r = Math.ceil(wideningReach / rgs) + 1;
  const cx = Math.floor(x / rgs);
  const cz = Math.floor(z / rgs);
  let best = 0;
  for (let ix = cx - r; ix <= cx + r; ix++) {
    for (let iz = cz - r; iz <= cz + r; iz++) {
      const s = regionSiteAt(ix, iz);
      const lakes = regionLakes(s.region);
      if (lakes.length === 0) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      let widening = 0;
      for (const l of lakes) widening += l.share * l.widening * Math.max(0, 1 - d / l.reach);
      best = Math.max(best, widening);
    }
  }
  return best;
};

export const clearJoins = (): void => lakesByRegion.clear();
