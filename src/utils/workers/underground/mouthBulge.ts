/**
 * THE MOUTH BULGE: the one change the caves make to the terrain's height (computeVertexData step 6), so
 * a mouth stands proud of its slope — a MOUND around the opening, a HOOD of rock over the section, a
 * LEDGE levelling the ground in front. Generated caves read the UN-bulged ground (systems.ts
 * `generatingTunnels`), so no mouth depends on its own bulge. Masked to nothing near roads, freeways,
 * rivers and water, where the pipeline caches road and deck data that must not depend on it. Also the
 * growth KEEP-OFF around a mouth (foliage, snow). Three-free.
 */

import { CellCache } from "../cellCache";
import { smoothstep } from "../../math";
import type { RectXZ } from "../../math/types";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../water/rivers/constants";
import {
  BULGE_MASK_FADE,
  BULGE_MASK_PAD,
  BULGE_MAX_REACH,
  HOOD_RISE,
  HOOD_ROCK,
  HOOD_SHOULDER,
  HOOD_TAIL,
  KEEP_OFF_PAD,
  KEEP_OFF_RADII,
  LEDGE_DROP,
  LEDGE_FADE_IN,
  LEDGE_HALF_WIDTH,
  LEDGE_LENGTH,
  LEDGE_ROUND,
  MOUND_FLOOR_FAR,
  MOUND_FLOOR_NEAR,
  MOUND_HEIGHT,
  MOUND_RADIUS,
  MOUND_STRIP_IN,
  MOUND_STRIP_OUT,
  MOUTH_TILE,
  MOUTH_TILES_MAX,
  AXIS_LIFT,
  FLOOR_HALF_WIDTH,
  MOUTH_RIM_AMP,
  WALL_BULGE,
} from "./constants";
import { caveBiomeIds } from "./params";
import { caveMouthsNear } from "./systems";
import { mouthAlong, mouthFloorAt, mouthLateral, mouthRadiusAt, mouthSectionDistance, mouthSectionDistanceToRect } from "./tunnelField";
import type { MouthPiece } from "./types";

export const NO_MOUTHS: readonly MouthPiece[] = [];

/** How far a mouth's bulge reaches from its section. */
const bulgeReach = (m: MouthPiece): number => MOUND_RADIUS * m.r0;

const tiles = new CellCache<readonly MouthPiece[]>(MOUTH_TILES_MAX);
let lastTileX = NaN;
let lastTileZ = NaN;
let lastTile: readonly MouthPiece[] = NO_MOUTHS;

export const clearMouthTiles = (): void => {
  tiles.clear();
  lastTileX = NaN;
  lastTileZ = NaN;
  lastTile = NO_MOUTHS;
};

/** The mouths whose bulge (or keep-off) can reach a point, per MOUTH_TILE tile. A cold tile generates the
 *  caves in reach, on whatever thread asks. */
export const mouthsNear = (x: number, z: number): readonly MouthPiece[] => {
  const tx = Math.floor(x / MOUTH_TILE);
  const tz = Math.floor(z / MOUTH_TILE);
  if (tx === lastTileX && tz === lastTileZ) return lastTile;
  let tile = tiles.get(tx, tz);
  if (!tile) {
    const ids = caveBiomeIds();
    const rect = { minX: tx * MOUTH_TILE, minZ: tz * MOUTH_TILE, maxX: (tx + 1) * MOUTH_TILE, maxZ: (tz + 1) * MOUTH_TILE };
    const found = ids.length === 0 ? [] : caveMouthsNear(ids, rect, BULGE_MAX_REACH).filter((m) => mouthSectionDistanceToRect(m, rect) < bulgeReach(m));
    tile = found.length > 0 ? found : NO_MOUTHS;
    tiles.makeRoom();
    tiles.set(tx, tz, tile);
  }
  lastTileX = tx;
  lastTileZ = tz;
  lastTile = tile;
  return tile;
};

export interface BulgeMask {
  waterHeight: number;
  distanceToRoadCenter: number;
  distanceToFreewayCenter: number;
  distanceToRiverCenter: number;
}

/** 0 near roads, freeways and rivers, rising to 1 past their keep-offs (BULGE_MASK_PAD, BULGE_MASK_FADE):
 *  the PRODUCT of the three fades, so where two are both mid-fade the bulge is lower than either alone. */
const bulgeMask = (near: BulgeMask): number => {
  const city = domainConfig!.cityConfig;
  const off = (distance: number, keepOff: number): number => smoothstep(keepOff + BULGE_MASK_PAD, keepOff + BULGE_MASK_PAD + BULGE_MASK_FADE, distance);
  return off(near.distanceToRoadCenter, city.roadWidth) * off(near.distanceToFreewayCenter, city.freewayWidth) * off(near.distanceToRiverCenter, riverKeepOff());
};

/** One mouth's mound and hood over raw ground `h` at (a, l) in its frame: never under `h`. */
const raised = (m: MouthPiece, a: number, l: number, dist: number, h: number): number => {
  const r0 = m.r0;
  let out = h;
  // The mound, a cosine bump around the opening, held off the walking strip in front while the ground
  // there is still near the floor (it would stand a lip across the way in).
  if (dist < MOUND_RADIUS * r0) {
    const floorHalf = FLOOR_HALF_WIDTH * r0;
    const strip = 1 - smoothstep(floorHalf + MOUND_STRIP_IN, floorHalf + MOUND_STRIP_OUT, Math.abs(l));
    const nearFloor = 1 - smoothstep(MOUND_FLOOR_NEAR, MOUND_FLOOR_FAR, h - mouthFloorAt(m, a));
    out += MOUND_HEIGHT * r0 * 0.5 * (1 + Math.cos((Math.PI * dist) / (MOUND_RADIUS * r0))) * (1 - strip * nearFloor);
  }
  // The hood: rock over the section up to its bulged crown and some, rising from the opening, full over
  // the widest the outline and the wall lumps swing, shouldered off beside that, trailing past the inner
  // end. From the raw ground: where the mound stands higher, the mound wins.
  if (a > 0) {
    const along = a < m.length ? a : m.length;
    const r = mouthRadiusAt(m, along);
    const top = mouthFloorAt(m, along) + AXIS_LIFT * r + r * (1 + WALL_BULGE) + HOOD_ROCK * r;
    const full = r * (1 + MOUTH_RIM_AMP + WALL_BULGE);
    const rise = smoothstep(0, HOOD_RISE * r0, a);
    const shoulder = 1 - smoothstep(full, full + HOOD_SHOULDER * r, Math.abs(l));
    const tail = a > m.length ? 1 - smoothstep(m.length, m.length + HOOD_TAIL * r0, a) : 1;
    const w = rise * shoulder * tail;
    if (w > 0 && top > h) {
      const hood = h + (top - h) * w;
      if (hood > out) out = hood;
    }
  }
  return out;
};

/** How much a mouth's ledge levels the ground at (a, l): from the opening's plane outward. */
const ledgeShare = (m: MouthPiece, a: number, l: number): number => {
  if (a >= 0) return 0;
  const r0 = m.r0;
  const out = -a;
  return smoothstep(0, LEDGE_FADE_IN * r0, out) * (1 - smoothstep(LEDGE_LENGTH * r0, (LEDGE_LENGTH + LEDGE_ROUND) * r0, out)) * (1 - smoothstep(LEDGE_HALF_WIDTH * r0, (LEDGE_HALF_WIDTH + LEDGE_ROUND) * r0, Math.abs(l)));
};

/** The ground `height` at (x, z) with the bulges of `mouths` (from mouthsNear) added. */
export const mouthBulgeAt = (mouths: readonly MouthPiece[], x: number, z: number, height: number, near: BulgeMask): number => {
  let lift = 0;
  let reached = false;
  for (const m of mouths) {
    if (mouthSectionDistance(m, x, z) >= bulgeReach(m)) continue;
    reached = true;
    const a = mouthAlong(m, x, z);
    const l = mouthLateral(m, x, z);
    const up = raised(m, a, l, Math.hypot(a, l), height) - height;
    if (up > lift) lift = up;
  }
  // Under water: none at all.
  if (!reached || near.waterHeight > height) return height;
  const mask = bulgeMask(near);
  if (mask <= 0) return height;
  let out = height + lift;
  for (const m of mouths) {
    const a = mouthAlong(m, x, z);
    const w = ledgeShare(m, a, mouthLateral(m, x, z));
    if (w > 0) out += (m.oy - LEDGE_DROP - out) * w;
  }
  return height + (out - height) * mask;
};

// ── The growth keep-off ──────────────────────────────────────────────────

/** How far growth keeps off a mouth's section. */
export const keepOffRadius = (m: MouthPiece): number => m.width + KEEP_OFF_RADII * m.r0 + KEEP_OFF_PAD;

/** Whether (x, z) lies in any mouth's keep-off (foliage: an instance is placed or not). */
export const insideCaveKeepOff = (mouths: readonly MouthPiece[], x: number, z: number): boolean => {
  for (const m of mouths) if (mouthSectionDistance(m, x, z) < keepOffRadius(m)) return true;
  return false;
};

/** 0 inside any mouth's keep-off, rising smoothly to 1 over `fade` past it (the snow scales its cover by
 *  it: a hard cut drew a sawtooth crest over every opening). */
export const caveKeepOffFade = (mouths: readonly MouthPiece[], x: number, z: number, fade: number): number => {
  let share = 1;
  for (const m of mouths) {
    const r = keepOffRadius(m);
    const s = smoothstep(r, r + fade, mouthSectionDistance(m, x, z));
    if (s < share) share = s;
  }
  return share;
};

/** The mouths whose keep-off reaches an area. */
export const keepOffMouthsNear = (area: RectXZ): MouthPiece[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return [];
  return caveMouthsNear(ids, area, BULGE_MAX_REACH).filter((m) => mouthSectionDistanceToRect(m, area) < keepOffRadius(m));
};
