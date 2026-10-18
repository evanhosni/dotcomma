/**
 * The MOUTH BULGE: the one height step the tunnels make (computeVertexData, step 6). Around every
 * cave mouth of every `caves: true` biome the ground is reshaped so the opening stands proud and is
 * walkable: a cosine mound, a hood over the section, a ledge in front. Mouths are looked up per
 * MOUTH_TILE tile (a cold tile generates the caves in reach). Also the growth keep-off around a
 * mouth, which foliage and snow read. Three-free.
 */

import { smoothstep } from "../../math/_math";
import type { RectXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../rivers/constants";
import { caveBiomeIds } from "../biomeFlags";
import {
  AXIS_LIFT,
  BULGE_FLOOR_STRIP_FADE,
  BULGE_FLOOR_STRIP_PAD,
  BULGE_HEIGHT,
  BULGE_MAX_REACH,
  BULGE_REACH,
  BULGE_RELIFT_HIGH,
  BULGE_RELIFT_LOW,
  BULGE_ROAD_FADE,
  BULGE_ROAD_PAD,
  FLOOR_HALF_WIDTH,
  HOOD_CROWN_ROCK,
  HOOD_RISE,
  HOOD_SHOULDER,
  HOOD_TAIL,
  KEEP_OFF_PAD,
  KEEP_OFF_RADII,
  LEDGE_FADE_IN,
  LEDGE_OUT,
  LEDGE_ROUND,
  LEDGE_SIDE,
  LEDGE_SINK,
  MOUTH_RIM_AMP,
  MOUTH_TILE,
  MOUTH_TILE_CACHE_MAX,
  WALL_BULGE,
} from "./constants";
import { caveMouthsNear } from "./systems";
import { mouthAlong, mouthFloorAt, mouthLateral, mouthRadiusAt, mouthSectionDistance, mouthSectionDistanceToRect } from "./tunnelField";
import type { MouthPiece } from "./types";

export const NO_MOUTHS: readonly MouthPiece[] = [];

const tiles = new Map<number, readonly MouthPiece[]>();
let lastTileKey = NaN;
let lastTile: readonly MouthPiece[] = NO_MOUTHS;

export const clearMouthTiles = (): void => {
  tiles.clear();
  lastTileKey = NaN;
  lastTile = NO_MOUTHS;
};

/** How far a mouth reshapes the ground around its section. */
const reachOf = (m: MouthPiece): number => BULGE_REACH * m.r0;

/** Every mouth whose bulge reaches the MOUTH_TILE tile holding (x, z). The last tile is remembered:
 *  a terrain chunk's vertices come row by row. */
export const mouthsNear = (x: number, z: number): readonly MouthPiece[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return NO_MOUTHS;
  const tx = Math.floor(x / MOUTH_TILE);
  const tz = Math.floor(z / MOUTH_TILE);
  const key = tx * 0x200000 + tz;
  if (key === lastTileKey) return lastTile;
  let list = tiles.get(key);
  if (!list) {
    if (tiles.size >= MOUTH_TILE_CACHE_MAX) dropOldestHalf(tiles);
    const minX = tx * MOUTH_TILE;
    const minZ = tz * MOUTH_TILE;
    const tile: RectXZ = { minX, minZ, maxX: minX + MOUTH_TILE, maxZ: minZ + MOUTH_TILE };
    list = caveMouthsNear(ids, tile, BULGE_MAX_REACH).filter((m) => mouthSectionDistanceToRect(m, tile) <= reachOf(m));
    if (list.length === 0) list = NO_MOUTHS;
    tiles.set(key, list);
  }
  lastTileKey = key;
  lastTile = list;
  return list;
};

/** What the bulge is masked by: zero under water and on roads, freeways and rivers. */
export interface BulgeContext {
  waterHeight: number;
  distanceToRoadCenter: number;
  distanceToFreewayCenter: number;
  distanceToRiverCenter: number;
}

/** The bulged height of a point at ground height `h` with `mouths` in reach. */
export const mouthBulgeAt = (mouths: readonly MouthPiece[], x: number, z: number, h: number, ctx: BulgeContext): number => {
  if (mouths.length === 0) return h;
  let lift = 0;
  let ledgeWeight = 0;
  let ledgeTarget = 0;
  for (const m of mouths) {
    const r0 = m.r0;
    const a = mouthAlong(m, x, z);
    const l = mouthLateral(m, x, z);
    const al = Math.abs(l);
    const dO = Math.sqrt((x - m.ox) * (x - m.ox) + (z - m.oz) * (z - m.oz));
    // The section's LOCAL radius and floor at this point (the opening's out front, the inner end's past it).
    const r = mouthRadiusAt(m, a);
    const floor = mouthFloorAt(m, a);
    // The mound: a cosine up to BULGE_HEIGHT radii high over BULGE_REACH radii, off over the floor's
    // strip while the ground is still at the floor.
    if (dO < BULGE_REACH * r0) {
      let mound = BULGE_HEIGHT * r0 * 0.5 * (1 + Math.cos((Math.PI * dO) / (BULGE_REACH * r0)));
      const halfW = r * FLOOR_HALF_WIDTH + BULGE_FLOOR_STRIP_PAD;
      const strip = 1 - smoothstep(halfW, halfW + BULGE_FLOOR_STRIP_FADE, al);
      if (strip > 0) mound *= 1 - strip * (1 - smoothstep(BULGE_RELIFT_LOW, BULGE_RELIFT_HIGH, h - floor));
      if (mound > lift) lift = mound;
    }
    // The hood over the section: rising from the opening to the bulged crown plus rock, full over the
    // local outline at its widest, shouldered off beside it, trailing off past the inner end.
    const full = r * (1 + WALL_BULGE + MOUTH_RIM_AMP);
    if (a > 0 && a < m.length + HOOD_TAIL * r0 && al < full + HOOD_SHOULDER * r) {
      const target = floor + (1 + AXIS_LIFT + WALL_BULGE + HOOD_CROWN_ROCK) * r;
      const hood =
        Math.max(0, target - h) *
        smoothstep(0, HOOD_RISE * r0, a) *
        (1 - smoothstep(full, full + HOOD_SHOULDER * r, al)) *
        (1 - smoothstep(m.length, m.length + HOOD_TAIL * r0, a));
      if (hood > lift) lift = hood;
    }
    // The ledge in front: levelled a little under the floor, fading in from the opening's plane and
    // rounding into the slope.
    if (a < 0 && a > -(LEDGE_OUT + LEDGE_ROUND) * r0 && al < (LEDGE_SIDE + 1) * r0) {
      const w = smoothstep(0, LEDGE_FADE_IN * r0, -a) * (1 - smoothstep(LEDGE_OUT * r0, (LEDGE_OUT + LEDGE_ROUND) * r0, -a)) * (1 - smoothstep(LEDGE_SIDE * r0, (LEDGE_SIDE + 1) * r0, al));
      if (w > ledgeWeight) {
        ledgeWeight = w;
        ledgeTarget = m.oy - LEDGE_SINK;
      }
    }
  }
  let bulged = h + lift;
  if (ledgeWeight > 0) bulged += (ledgeTarget - bulged) * ledgeWeight;
  if (bulged === h) return h;
  if (ctx.waterHeight > h) return h;
  const city = domainConfig!.cityConfig;
  const mask =
    smoothstep(city.roadWidth + BULGE_ROAD_PAD, city.roadWidth + BULGE_ROAD_PAD + BULGE_ROAD_FADE, ctx.distanceToRoadCenter) *
    smoothstep(city.freewayWidth + BULGE_ROAD_PAD, city.freewayWidth + BULGE_ROAD_PAD + BULGE_ROAD_FADE, ctx.distanceToFreewayCenter) *
    smoothstep(riverKeepOff() + BULGE_ROAD_PAD, riverKeepOff() + BULGE_ROAD_PAD + BULGE_ROAD_FADE, ctx.distanceToRiverCenter);
  return h + (bulged - h) * mask;
};

/** The growth keep-off: nothing (foliage, snow) within the widest outline + KEEP_OFF_RADII radii +
 *  KEEP_OFF_PAD of a mouth's section, seen from above. */
export const keepOffRadius = (m: MouthPiece): number => m.width + KEEP_OFF_RADII * m.r0 + KEEP_OFF_PAD;

export const insideCaveKeepOff = (mouths: readonly MouthPiece[], x: number, z: number): boolean => {
  for (const m of mouths) if (mouthSectionDistance(m, x, z) < keepOffRadius(m)) return true;
  return false;
};

/** The keep-off as a share: 0 inside every mouth's, rising to 1 over `fade` past it (the snow scales its
 *  cover by it, snow/snowDrift.ts — cut node by node, the sheet's edge drew every keep-off as a sawtooth
 *  crest over the opening). */
export const caveKeepOffFade = (mouths: readonly MouthPiece[], x: number, z: number, fade: number): number => {
  let share = 1;
  for (const m of mouths) {
    const r = keepOffRadius(m);
    share = Math.min(share, smoothstep(r, r + fade, mouthSectionDistance(m, x, z)));
    if (share <= 0) break;
  }
  return share;
};

/** The mouths whose keep-off can reach an area. */
export const keepOffMouthsNear = (area: RectXZ): MouthPiece[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return [];
  return caveMouthsNear(ids, area, BULGE_MAX_REACH).filter((m) => mouthSectionDistanceToRect(m, area) < keepOffRadius(m));
};

