import { seedRand, smoothstep } from "../../utils/math";
import type { RectXZ } from "../../utils/math/types";
import { caveParamsOf, sewerParamsOf, caveBiomeIds } from "./params";
import { dropOldestHalf } from "../cache/utils";
import { domainConfig } from "../store";
import { unwarp, warpMax } from "../utils";
import { biomeSiteAt } from "../zones";
import { generateCave } from "./caves";
import { SYSTEM_CACHE_MAX, BULGE_MASK_FADE, BULGE_MASK_PAD, BULGE_MAX_REACH, HOOD_RISE, HOOD_ROCK, HOOD_SHOULDER, HOOD_TAIL, KEEP_OFF_PAD, KEEP_OFF_RADII, LEDGE_DROP, LEDGE_FADE_IN, LEDGE_HALF_WIDTH, LEDGE_LENGTH, LEDGE_ROUND, MOUND_FLOOR_FAR, MOUND_FLOOR_NEAR, MOUND_HEIGHT, MOUND_RADIUS, MOUND_STRIP_IN, MOUND_STRIP_OUT, MOUTH_TILE, MOUTH_TILES_MAX, AXIS_LIFT, FLOOR_HALF_WIDTH, MOUTH_RIM_AMP, WALL_BULGE } from "./constants";
import { clearDrawnGround } from "../drawn-ground";
import { finishSewer, generateSewer, isSewerSystem } from "./sewers";
import { boundsTouchXZ, mouthAlong, mouthFloorAt, mouthLateral, mouthRadiusAt, mouthSectionDistance, mouthSectionDistanceToRect } from "./field";
import type { MouthPiece, TunnelStyle, TunnelSystem } from "./types";
import { CellCache } from "../cache/CellCache";
import { riverKeepOff } from "../water/rivers/constants";

/** Tunnel systems per biome cell: generated once per thread, remembered, and found by area. Three-free. */

/** > 0 while a system is being generated: every ground height read then leaves the mouth bulge out,
 *  so no mouth depends on its own bulge and no seed moves (and the drawn-ground lattice is not filled
 *  with un-bulged heights). */
export let generatingTunnels = 0;

/** Runs a generator with the bulge held off (generatingTunnels). */
const whileGeneratingTunnels = <T>(generate: () => T): T => {
  generatingTunnels++;
  try {
    return generate();
  } finally {
    generatingTunnels--;
  }
};

const systems = new Map<string, TunnelSystem | null>();

/** Every tunnel cache this module owns, and the drawn ground's; initCompute calls it (a new seed/config). */
export const clearTunnelCaches = (): void => {
  systems.clear();
  clearDrawnGround();
};

const systemKey = (style: TunnelStyle, biomeId: number, ix: number, iz: number): string => `${style}|${biomeId}|${ix},${iz}`;

/** The system of a biome cell, or null: the cell's site must belong to the biome and pass the roll. */
export const systemAt = (style: TunnelStyle, biomeId: number, ix: number, iz: number): TunnelSystem | null => {
  const key = systemKey(style, biomeId, ix, iz);
  const cached = systems.get(key);
  if (cached !== undefined) return cached;
  if (systems.size >= SYSTEM_CACHE_MAX) dropOldestHalf(systems);
  const site = biomeSiteAt(ix, iz);
  if (site.zone.biome.id !== biomeId) {
    systems.set(key, null);
    return null;
  }
  // A biome holds tunnels only where its spec's `features` mount them (the config's `caves` / `sewers`).
  const caves = style === "cave" ? caveParamsOf(biomeId) : null;
  const sewers = style === "sewer" ? sewerParamsOf(biomeId) : null;
  const chance = (caves ?? sewers)?.chance ?? 0;
  if (seedRand(`${domainConfig!.seed}|${key}`) >= chance) {
    systems.set(key, null);
    return null;
  }
  const world = unwarp(site.x, site.z);
  const system = whileGeneratingTunnels(() => (caves ? generateCave(key, biomeId, ix, iz, world, caves.sideRooms) : generateSewer(key, biomeId, ix, iz, world, sewers!.sideRooms)));
  // Cached before anything reads the ground WITH the bulge (the manhole rests), so a lookup from
  // inside that read finds this system instead of generating it again.
  systems.set(key, system);
  if (system && isSewerSystem(system)) finishSewer(system);
  return system;
};

/** The systems of `style` under `biomeId` whose extents (padded by `pad`) touch the area: the cells up
 *  to 2 away in each direction of the area padded by the road warp's maximum. */
export const systemsNear = (style: TunnelStyle, biomeId: number, area: RectXZ, pad = 0): TunnelSystem[] => {
  if (!domainConfig) return [];
  const gs = domainConfig.gridSize;
  const wm = warpMax();
  const ix0 = Math.floor((area.minX - pad - wm) / gs) - 2;
  const ix1 = Math.floor((area.maxX + pad + wm) / gs) + 2;
  const iz0 = Math.floor((area.minZ - pad - wm) / gs) - 2;
  const iz1 = Math.floor((area.maxZ + pad + wm) / gs) + 2;
  const out: TunnelSystem[] = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const s = systemAt(style, biomeId, ix, iz);
      if (s && boundsTouchXZ(s.bounds, area.minX, area.minZ, area.maxX, area.maxZ, pad)) out.push(s);
    }
  }
  return out;
};

/** The floor centre of every cave side room (<Rooms> in <Caves>: a room on the trunk or a branch tip) whose
 *  centre lies in the area: what an <Actor> inside those <Rooms> stands one actor on. */
export const caveSideRoomsIn = (biomeId: number, area: RectXZ): { x: number; z: number; floor: number }[] => {
  const out: { x: number; z: number; floor: number }[] = [];
  for (const s of systemsNear("cave", biomeId, area)) {
    for (const p of s.pieces) {
      if (p.kind !== "room") continue;
      const x = (p.ax + p.bx) / 2;
      const z = (p.az + p.bz) / 2;
      if (x >= area.minX && x < area.maxX && z >= area.minZ && z < area.maxZ) out.push({ x, z, floor: p.ay });
    }
  }
  return out;
};

/** Every mouth of the caves of `caveBiomeIds` whose system reaches the area padded by `pad`: the one "mouths
 *  near an area" the bulge, the keep-off, the rocks and the snow share. */
export const caveMouthsNear = (caveBiomeIds: readonly number[], area: RectXZ, pad = 0): MouthPiece[] => {
  const out: MouthPiece[] = [];
  for (const id of caveBiomeIds) for (const s of systemsNear("cave", id, area, pad)) out.push(...s.mouths);
  return out;
};

/**
 * THE MOUTH BULGE: the one change the caves make to the terrain's height (computeVertexData step 6), so
 * a mouth stands proud of its slope — a MOUND around the opening, a HOOD of rock over the section, a
 * LEDGE levelling the ground in front. Generated caves read the UN-bulged ground (generation/underground/index.ts
 * `generatingTunnels`), so no mouth depends on its own bulge. Masked to nothing near roads, freeways,
 * rivers and water, where the pipeline caches road and deck data that must not depend on it. Also the
 * growth KEEP-OFF around a mouth (foliage, snow). Three-free.
 */

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
