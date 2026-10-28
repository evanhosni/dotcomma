/** Tunnel systems per biome cell: generated once per thread, remembered, and found by area. Three-free. */

import { seedRand } from "../../math";
import type { RectXZ } from "../../math/types";
import { caveParamsOf, sewerParamsOf } from "./params";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { unwarp, warpMax } from "../noise";
import { biomeSiteAt } from "../voronoi";
import { finishConnectedSpring, finishLoneSpring, finishPairedSpring, generateCave, planSpring, springGap, type SpringPlan } from "./caves";
import { springSitesInCell, type SpringSite } from "./springs";
import { SPRING_SHARE_REACH, SYSTEM_CACHE_MAX } from "./constants";
import { clearDrawnGround } from "./drawnGround";
import { finishSewer, generateSewer, isSewerSystem } from "./sewers";
import { boundsTouchXZ } from "./tunnelField";
import type { MouthPiece, TunnelStyle, TunnelSystem } from "./types";

/** > 0 while a system is being generated: every ground height read then leaves the mouth bulge out,
 *  so no mouth depends on its own bulge and no seed moves (and the drawn-ground lattice is not filled
 *  with un-bulged heights). */
export let generatingTunnels = 0;

const systems = new Map<string, TunnelSystem | null>();

/** Every tunnel cache this module owns and the drawn ground's; initCompute calls it (a new seed/config). */
export const clearTunnelCaches = (): void => {
  systems.clear();
  springSystems.clear();
  springPlans.clear();
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
  generatingTunnels++;
  let system: TunnelSystem | null;
  try {
    system = caves ? generateCave(key, biomeId, ix, iz, world, caves.sideRooms) : generateSewer(key, biomeId, ix, iz, world, sewers!.sideRooms);
  } finally {
    generatingTunnels--;
  }
  // Cached before anything reads the ground WITH the bulge (the manhole rests), so a lookup from
  // inside that read finds this system instead of generating it again.
  systems.set(key, system);
  if (system && isSewerSystem(system)) finishSewer(system);
  return system;
};

const springSystems = new Map<string, TunnelSystem[]>();
/** Every spring's plan by its site id (a plan is a pure function of its site: every cell around reads the same). */
const springPlans = new Map<string, SpringPlan | null>();

const springPlanOf = (biomeId: number, site: SpringSite): SpringPlan | null => {
  const planKey = `spring|${biomeId}|${site.id}`;
  let plan = springPlans.get(planKey);
  if (plan === undefined) {
    if (springPlans.size >= SYSTEM_CACHE_MAX * 4) dropOldestHalf(springPlans);
    plan = planSpring(planKey, site);
    springPlans.set(planKey, plan);
  }
  return plan;
};

/** The SPRING caves of a biome cell (one per river running into the rock there, springs.ts): the
 *  cell's own caves' siblings, generated and remembered like them. Two springs whose leads end within
 *  SPRING_SHARE_REACH of each other CONNECT: one river through a hall between them, and no pool. The
 *  pairing is by MUTUAL NEAREST, each spring judged over the springs of its own cell and the eight
 *  around it — symmetric and local, so a spring and its partner in another cell are paired the same
 *  from both cells (a greedy pass over one cell's springs missed partners across the border: two rooms
 *  stacked at one spot). The
 *  hall belongs to the pair's first member by key, emitted by that member's cell. A spring with no
 *  partner ends in a pool room. */
export const springSystemsAt = (biomeId: number, ix: number, iz: number): TunnelSystem[] => {
  const key = `spring|${biomeId}|${ix},${iz}`;
  const cached = springSystems.get(key);
  if (cached) return cached;
  if (springSystems.size >= SYSTEM_CACHE_MAX) dropOldestHalf(springSystems);
  generatingTunnels++;
  const out: TunnelSystem[] = [];
  try {
    // Each spring is judged over the 3×3 cells around ITS OWN cell, so the 5×5 around this one holds
    // every candidate of this cell's springs AND of their partners next door: the same verdict from both.
    const cellOf = new Map<SpringPlan, { cx: number; cz: number }>();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (const site of springSitesInCell(biomeId, ix + dx, iz + dz)) {
          const plan = springPlanOf(biomeId, site);
          if (plan) cellOf.set(plan, { cx: ix + dx, cz: iz + dz });
        }
      }
    }
    const nearest = (p: SpringPlan): SpringPlan | null => {
      const c = cellOf.get(p)!;
      let best: SpringPlan | null = null;
      let bestGap = SPRING_SHARE_REACH;
      for (const [q, qc] of cellOf) {
        if (q === p || Math.abs(qc.cx - c.cx) > 1 || Math.abs(qc.cz - c.cz) > 1) continue;
        const gap = springGap(p, q);
        if (gap < bestGap || (gap === bestGap && best !== null && q.key < best.key)) {
          best = q;
          bestGap = gap;
        }
      }
      return best;
    };
    const own = [...cellOf].filter(([, c]) => c.cx === ix && c.cz === iz).map(([plan]) => plan);
    for (const plan of own.sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const partner = nearest(plan);
      if (partner && nearest(partner) === plan) out.push(plan.key < partner.key ? finishConnectedSpring(plan, partner, biomeId, ix, iz) : finishPairedSpring(plan, biomeId, ix, iz));
      else out.push(finishLoneSpring(plan, biomeId, ix, iz));
    }
  } finally {
    generatingTunnels--;
  }
  springSystems.set(key, out);
  return out;
};

/** The systems of `style` under `biomeId` whose extents (padded by `pad`) touch the area: the cells up
 *  to 2 away in each direction of the area padded by the road warp's maximum. Caves include the
 *  cells' spring caves. */
export const systemsNear = (style: TunnelStyle, biomeId: number, area: RectXZ, pad = 0): TunnelSystem[] => {
  if (!domainConfig) return [];
  const gs = domainConfig.gridSize;
  const wm = warpMax();
  const ix0 = Math.floor((area.minX - pad - wm) / gs) - 2;
  const ix1 = Math.floor((area.maxX + pad + wm) / gs) + 2;
  const iz0 = Math.floor((area.minZ - pad - wm) / gs) - 2;
  const iz1 = Math.floor((area.maxZ + pad + wm) / gs) + 2;
  const out: TunnelSystem[] = [];
  const touching = (s: TunnelSystem): boolean => boundsTouchXZ(s.bounds, area.minX, area.minZ, area.maxX, area.maxZ, pad);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const s = systemAt(style, biomeId, ix, iz);
      if (s && touching(s)) out.push(s);
      if (style === "cave") for (const spring of springSystemsAt(biomeId, ix, iz)) if (touching(spring)) out.push(spring);
    }
  }
  return out;
};

/** The floor centre of every cave side room (<CaveSideRoom>: a room on the trunk or a branch tip, never a
 *  spring's pool room) whose centre lies in the area: what a <Spawn> inside it stands one actor on. */
export const caveSideRoomsIn = (biomeId: number, area: RectXZ): { x: number; z: number; floor: number }[] => {
  const out: { x: number; z: number; floor: number }[] = [];
  for (const s of systemsNear("cave", biomeId, area, 0)) {
    if (!s.key.startsWith("cave|")) continue;
    for (const p of s.pieces) {
      if (p.kind !== "room") continue;
      const x = (p.ax + p.bx) / 2;
      const z = (p.az + p.bz) / 2;
      if (x >= area.minX && x < area.maxX && z >= area.minZ && z < area.maxZ) out.push({ x, z, floor: p.ay });
    }
  }
  return out;
};

/** Every mouth of the caves of `caveBiomeIds` whose system reaches the area padded by `pad`. */
export const caveMouthsNear = (caveBiomeIds: readonly number[], area: RectXZ, pad = 0): MouthPiece[] => {
  const out: MouthPiece[] = [];
  for (const id of caveBiomeIds) for (const s of systemsNear("cave", id, area, pad)) for (const m of s.mouths) out.push(m);
  return out;
};
