/**
 * PONDS (<Pond>): where each kind stands, as DISCS of the river field (rivers/field.ts). The modes a river
 * decides (an end, mid-river, a summit) live with the river (rivers/ponds.ts, rivers/summits.ts) and roll their
 * kind here (pondKindAt); this module is the STANDALONE mode (water/DECISIONS.md "Ponds"): one opportunity
 * per STANDALONE_CELL of warped space, rolled FIRST (a cell that rolls nothing costs one seedRand) in the
 * biome under its first spot; it stands on the flattest clear one of nine seeded spots whose biome carries
 * that kind (not steep; not in or near a lake, near a river or a road), unless a stronger neighbour stands
 * too close. Every decision is a pure function of the cell and its 8 neighbours, so any query order and
 * window agree. Rivers are read through their one interface (../rivers). Three-free.
 *
 * Like every pipeline module it imports the others in a cycle (vertexCompute.ts): no export of theirs is
 * used at this module's top level.
 */

import { seedRand } from "../../../math";
import type { RectXZ } from "../../../math/types";
import { CellCache } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import { unwarp, warpMax } from "../../noise";
import { getBiomeContext, zoneAtWarped } from "../../voronoi";
import { WATER_BELOW_GROUND } from "../constants";
import { waterGroundAt } from "../utils";
import { shoreReach } from "../lakes";
import { isLakeBiome } from "../lakes/params";
import { DISC_WIDTH_MAX, riverFootprintWithin, riverKeepOff, riverPondDiscsIn } from "../rivers";
import { RIVER_FIELD_READ } from "../constants";
import { bearsRoads, pondTouchesRoad } from "../utils";
import type { FieldDisc } from "../types";
import { registerWaterBodyKind } from "../params";
import { POND_KIND, POND_MAX_SPREAD, POND_MODES, type PondMode, type PondMount, pondsOf } from "./params";

/** One standalone opportunity per cell this wide (warped units): `standalone` 1 is one per km². */
const STANDALONE_CELL = 1000;
/** Seeded spots tried per cell; the flattest clear one wins. */
const STANDALONE_TRIES = 9;

/** A placed pond: its disc, the biome it stands in, its kind and the key its seeds hang from. */
export interface PondPlace {
  disc: FieldDisc;
  biomeId: number;
  mount: PondMount;
  key: string;
  /** Its roll: the lower wins a clash between neighbours. */
  roll: number;
}

/** A pond's waterline radius `r` (real) as a disc's width (factor-1 units), capped so its widest blobbed
 *  waterline is a river joint's widest (DISC_WIDTH_MAX). */
export const pondWidth = (r: number, blobAmount: number): number => Math.min(r / domainConfig!.river.halfWidth, DISC_WIDTH_MAX / (1 + blobAmount));
/** A pond's footprint radius (real): its widest blobbed waterline plus its bank, as the field draws it. */
export const pondFootprint = (width: number, blobAmount: number): number => riverKeepOff() * width * (1 + blobAmount);
const discFootprint = (d: FieldDisc): number => pondFootprint(d.width, d.amount);

/** Four points round a pond's radius: the first toward its `dir`, a quarter turn apart. */
const AROUND: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
/** A pond's SPOT: how far the ground under it spreads — over its centre and four points round its radius
 *  `r` (AROUND, turned toward the unit `dir`) — and the lowest of them, which its level hangs under (its
 *  bank then cuts a bowl into the higher ground rather than its rim holding the lower up as a terrace).
 *  What a standalone pond and a summit's both stand on the flattest of. */
export const pondSite = (x: number, z: number, r: number, dirX = 1, dirZ = 0): { spread: number; low: number } => {
  const centre = waterGroundAt(x, z).h;
  let low = centre;
  let high = centre;
  for (const [c, s] of AROUND) {
    const h = waterGroundAt(x + r * (dirX * c - dirZ * s), z + r * (dirZ * c + dirX * s)).h;
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  return { spread: high - low, low };
};

/** The kind a roll `u` picks in a biome for a mode: its mounts' chances of that mode, cumulative in JSX
 *  order (null: none — the opportunity stays as it would be without ponds: a river end ends round). */
export const pondKindAt = (biomeId: number, mode: PondMode, u: number): PondMount | null => {
  let sum = 0;
  for (const m of pondsOf(biomeId)) {
    if (m[mode] <= 0) continue;
    sum += m[mode];
    if (u < sum) return m;
  }
  return null;
};

/** The largest summed chance of a mode in any biome: a roll over it is no pond anywhere (0: the mode
 *  places nothing in this domain, and costs nothing). Found once per init. */
let maxChanceFound = false;
const maxChance: Record<PondMode, number> = { riverEnd: 0, midRiver: 0, summit: 0, standalone: 0 };
export const pondModeMax = (mode: PondMode): number => {
  if (!maxChanceFound) {
    maxChanceFound = true;
    for (const m of POND_MODES) maxChance[m] = 0;
    for (const region of domainConfig?.regions ?? []) {
      for (const biome of region.biomes) {
        for (const m of POND_MODES) {
          let sum = 0;
          for (const p of pondsOf(biome.id)) sum += Math.max(0, p[m]);
          maxChance[m] = Math.max(maxChance[m], sum);
        }
      }
    }
  }
  return maxChance[mode];
};

/** The smallest pond radius (real) at a warped point: its biome's `pondMinRadius`, else its region's, else
 *  the domain's — every pond, of every kind and mode, is at least this wide. */
export const pondMinRadiusAt = (x: number, z: number): number => {
  const zone = zoneAtWarped(x, z);
  return zone.biome.pondMinRadius ?? zone.region.pondMinRadius ?? domainConfig!.defaultPondMinRadius;
};

/** A pond's waterline radius (real), seeded in its kind's range. */
export const pondRadius = (mount: PondMount, key: string): number => {
  const [r0, r1] = mount.kind.radius;
  return r0 + (r1 - r0) * seedRand(`${key} r`);
};

/** A pond's disc in the river field: its kind's shape, and its <Pond>'s body — ONE owner for the whole
 *  disc, whatever biome a vertex of it stands in. */
export const pondDisc = (mount: PondMount, x: number, z: number, r: number, level: number, phaseKey: string): FieldDisc => ({
  x,
  z,
  width: pondWidth(r, mount.kind.blob.amount),
  level,
  depth: mount.kind.depth,
  amount: mount.kind.blob.amount,
  lobes: mount.kind.blob.lobes,
  phase: 100 * seedRand(phaseKey),
  body: mount.body,
});

/** Whether nothing that keeps water away stands within `footprint` of a warped point: a lake (its zone,
 *  or its shore within reach), a road-bearing biome, a river (its footprint and the field's whole support
 *  past it), or a road. */
const clearOfOthers = (x: number, z: number, footprint: number): boolean => {
  const ctx = getBiomeContext({ x, z });
  if (isLakeBiome(ctx.zone.biome) || bearsRoads(ctx.zone.biome.id)) return false;
  const ground = waterGroundAt(x, z);
  if (!Number.isNaN(ground.level) || ground.shore < shoreReach()) return false;
  if (riverFootprintWithin(x, z, footprint + RIVER_FIELD_READ)) return false;
  return !pondTouchesRoad(x, z, footprint, null);
};

/** A cell's pond before its neighbours are consulted (null: none). */
const candidateOf = (cx: number, cz: number): PondPlace | null => {
  const key = `${domainConfig!.seed} - water cell ${cx},${cz}`;
  const u = seedRand(key);
  if (u >= pondModeMax("standalone")) return null;
  // The kind: the roll in the biome under the cell's first spot, so a kind's ponds come at its
  // chance per km² OF ITS BIOMES. Its spot: the flattest clear one of those whose biome carries it.
  const spot = (k: number) => ({ x: (cx + seedRand(`${key} x${k}`)) * STANDALONE_CELL, z: (cz + seedRand(`${key} z${k}`)) * STANDALONE_CELL });
  const kind = pondKindAt(getBiomeContext(spot(0)).zone.biome.id, "standalone", u)?.kind.id;
  if (!kind) return null;
  const tries: { disc: FieldDisc; spread: number; r: number; biomeId: number; mount: PondMount }[] = [];
  for (let k = 0; k < STANDALONE_TRIES; k++) {
    const { x, z } = spot(k);
    const biomeId = getBiomeContext({ x, z }).zone.biome.id;
    const mount = pondsOf(biomeId).find((m) => m.kind.id === kind && m.standalone > 0);
    if (!mount) continue;
    const [r0, r1] = mount.kind.radius;
    const r = Math.max(r0 + (r1 - r0) * seedRand(`${key} r${k}`), pondMinRadiusAt(x, z));
    const { spread, low } = pondSite(x, z, r);
    if (spread > (mount.kind.maxSpread ?? POND_MAX_SPREAD) * r) continue;
    const disc = pondDisc(mount, x, z, r, low - WATER_BELOW_GROUND, `${key} phase${k}`);
    tries.push({ disc, spread, r, biomeId, mount });
  }
  tries.sort((a, b) => a.spread / a.r - b.spread / b.r);
  const chosen = tries.find((t) => clearOfOthers(t.disc.x, t.disc.z, discFootprint(t.disc)));
  return chosen ? { disc: chosen.disc, biomeId: chosen.biomeId, mount: chosen.mount, key, roll: u } : null;
};

const candidates = new CellCache<PondPlace | null>(4096);
const finals = new CellCache<PondPlace | null>(4096);
/** Cells being decided: a terrain query inside one never re-enters it. */
const deciding = new Set<string>();

const candidateAt = (cx: number, cz: number): PondPlace | null => {
  let c = candidates.get(cx, cz);
  if (c === undefined) {
    const id = `${cx},${cz}`;
    if (deciding.has(id)) return null;
    deciding.add(id);
    try {
      c = candidateOf(cx, cz);
    } finally {
      deciding.delete(id);
    }
    candidates.makeRoom();
    candidates.set(cx, cz, c);
  }
  return c;
};

/** A cell's pond: its candidate, unless a neighbour's with a lower roll stands too close. */
const pondAt = (cx: number, cz: number): PondPlace | null => {
  let s = finals.get(cx, cz);
  if (s === undefined) {
    s = candidateAt(cx, cz);
    for (let dx = -1; dx <= 1 && s; dx++) {
      for (let dz = -1; dz <= 1 && s; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = candidateAt(cx + dx, cz + dz);
        if (!n || n.roll > s.roll || (n.roll === s.roll && (dx > 0 || (dx === 0 && dz > 0)))) continue;
        if (Math.hypot(n.disc.x - s.disc.x, n.disc.z - s.disc.z) < discFootprint(n.disc) + discFootprint(s.disc)) s = null;
      }
    }
    finals.makeRoom();
    finals.set(cx, cz, s);
  }
  return s;
};

/** Every standalone pond whose centre lies in the warped box. */
export const pondsIn = (x0: number, z0: number, x1: number, z1: number): PondPlace[] => {
  const out: PondPlace[] = [];
  if (!domainConfig || pondModeMax("standalone") <= 0) return out;
  for (let cx = Math.floor(x0 / STANDALONE_CELL); cx <= Math.floor(x1 / STANDALONE_CELL); cx++) {
    for (let cz = Math.floor(z0 / STANDALONE_CELL); cz <= Math.floor(z1 / STANDALONE_CELL); cz++) {
      const s = pondAt(cx, cz);
      if (s && s.disc.x >= x0 && s.disc.x < x1 && s.disc.z >= z0 && s.disc.z < z1) out.push(s);
    }
  }
  return out;
};

/** EVERY pond's disc whose centre lies in the warped box — the standalone ones and those the rivers hold:
 *  what the river field's tile builder adds. */
export const pondDiscsIn = (x0: number, z0: number, x1: number, z1: number): FieldDisc[] => [
  ...pondsIn(x0, z0, x1, z1).map((s) => s.disc),
  ...riverPondDiscsIn(x0, z0, x1, z1),
];

/** Where a pond body's water and bank can lie in a world box: a box around each of its ponds there (the
 *  warp bends a footprint by less than the slack). What narrows its parts' scatter (water/parts). */
const pondReachIn = (slot: number, area: RectXZ): RectXZ[] => {
  const out: RectXZ[] = [];
  const pad = warpMax() + riverKeepOff() * DISC_WIDTH_MAX;
  for (const disc of pondDiscsIn(area.minX - pad, area.minZ - pad, area.maxX + pad, area.maxZ + pad)) {
    if (disc.body !== slot) continue;
    const c = unwarp(disc.x, disc.z);
    const r = 1.25 * discFootprint(disc) + 8;
    out.push({ minX: c.x - r, minZ: c.z - r, maxX: c.x + r, maxZ: c.z + r });
  }
  return out;
};

registerWaterBodyKind(POND_KIND, { reachIn: pondReachIn });

export const clearPonds = (): void => {
  candidates.clear();
  finals.clear();
  maxChanceFound = false;
};
