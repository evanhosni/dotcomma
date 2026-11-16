/** Tunnel systems per biome cell: generated once per thread, remembered, and found by area. Three-free. */

import { seedRand } from "../../math";
import type { RectXZ } from "../../math/types";
import { caveParamsOf, sewerParamsOf } from "./params";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp, warpMax } from "../noise";
import { biomeSiteAt } from "../voronoi";
import { generateCave } from "./caves";
import { SYSTEM_CACHE_MAX } from "./constants";
import { clearDrawnGround } from "./drawnGround";
import { finishSewer, generateSewer, isSewerSystem } from "./sewers";
import { boundsTouchXZ } from "./tunnelField";
import type { MouthPiece, TunnelStyle, TunnelSystem } from "./types";

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
