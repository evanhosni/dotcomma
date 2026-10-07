/**
 * FLATTEN-GROUND PADS (actors with flattenGround: true; CLAUDE.md "Flatten-ground pads").
 *
 * Spawn points need terrain height and the terrain depends on spawn points; resolved by FULLY
 * DETERMINISTIC placement both consumers share: candidates roll the exact spawn.worker
 * seeds/filters against the RAW height (recursion guard), spacing is stateless per canonical
 * tile, and spawn.worker sources flattenGround points FROM getFlattenPoints.
 */

import { smoothstep } from "../math/_math";
import { dropOldestHalf } from "./cellCache";
import { domainConfig } from "./computeConfig";
import { densityCellRange, densityCellSize, densityProbability, passesPlacementFilters, rollDensityCell } from "./densityGrid";
import { riverKeepOff } from "./rivers/constants";
import type { DomainConfig, FlattenDescriptor, VertexResult } from "./types";
import { computeVertexData, outsideBiomes } from "./vertexCompute";

const FLATTEN_TILE = 128; // world units per canonical placement tile
// Spacing rounds: 1 round = Matérn II (~45% of greedy packing); 4 rounds
// converge to greedy-level density while staying window-consistent.
const FLATTEN_SPACING_ROUNDS = 4;

interface FlattenCandidate {
  x: number;
  z: number;
  y: number;
  biomeId: number;
  descIndex: number;
  gx: number;
  gz: number;
}

export interface FlattenPoint {
  x: number;
  z: number;
  y: number; // raw ground height at the center = the pad height
  biomeId: number;
  descId: string;
  radius: number;
  skirt: number;
}

const flattenTileCache = new Map<string, FlattenPoint[]>();
// Boundary cells are shared by overlapping tile windows (~2.2× re-evaluation without this). null = rolled/filtered out.
const flattenCandCache = new Map<string, FlattenCandidate | null>();
let flattenReach = 0; // max(radius + skirt) — vertex lookup reach
let flattenSpacingPad = 0; // max footprint — spacing window pad
let flattenBiomes: Set<number> | null = null; // union of descs' biomeIds; null = unrestricted
/** Recursion guard: pad candidates evaluate their filters against the RAW (pad-free) height. */
export let evaluatingPadCandidates = false;

/** Pad-free — for sparse scans that would otherwise compute a pad tile per lonely sample. */
export function computeVertexDataRaw(x: number, z: number): VertexResult {
  // Restores the flag it found: a raw evaluation nested in another (a pad candidate's, the road
  // fragments' flood fill) must leave the outer one raw.
  const outer = evaluatingPadCandidates;
  evaluatingPadCandidates = true;
  try {
    return computeVertexData(x, z);
  } finally {
    evaluatingPadCandidates = outer;
  }
}

/** Every descriptor's density-grid candidates in a box that pass the placement filters against the
 *  RAW height (the spawn worker's own rolls), per cell cached across tiles. */
const rollPadCandidates = (pMinX: number, pMinZ: number, pMaxX: number, pMaxZ: number, descs: FlattenDescriptor[]): FlattenCandidate[] => {
  const candidates: FlattenCandidate[] = [];
  for (let di = 0; di < descs.length; di++) {
    const desc = descs[di];
    const cellSize = densityCellSize(desc.density);
    const [gx0, gx1] = densityCellRange(pMinX, pMaxX, cellSize);
    const [gz0, gz1] = densityCellRange(pMinZ, pMaxZ, cellSize);
    const probability = densityProbability(desc.density, cellSize);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const candKey = `${di}:${gx},${gz}`;
        const cached = flattenCandCache.get(candKey);
        if (cached !== undefined) {
          if (cached !== null) candidates.push(cached);
          continue;
        }
        if (flattenCandCache.size > 65536) dropOldestHalf(flattenCandCache);

        let cand: FlattenCandidate | null = null;
        const roll = rollDensityCell(desc.id, gx, gz, cellSize, probability, desc.clustering);
        // The biome filter first, from the point's own zone (exactly the raw evaluation's biomeId):
        // most candidates of a city descriptor stand outside the city, and each raw evaluation is a
        // whole vertex (MEASURED: 77% of the building descriptor's rolls in a 2 km square near a city).
        if (roll && !outsideBiomes(desc.biomeIds, roll.x, roll.z)) {
          const vd = computeVertexDataRaw(roll.x, roll.z);
          if (passesPlacementFilters(vd, desc, riverKeepOff())) {
            cand = { x: roll.x, z: roll.z, y: vd.height, biomeId: vd.biomeId, descIndex: di, gx, gz };
          }
        }
        flattenCandCache.set(candKey, cand);
        if (cand !== null) candidates.push(cand);
      }
    }
  }
  return candidates;
};

/** Iterated LOCAL spacing (Matérn-II rounds): a candidate is rejected by any earlier-ordered POOL
 *  member within its footprint — purely local, so tiles agree (greedy against ACCEPTED points would
 *  chain acceptances across tile windows). One round packs ~45% of greedy; the re-entry rounds
 *  converge. Sorts `candidates` in place. */
const spacePadCandidates = (candidates: FlattenCandidate[], descs: FlattenDescriptor[]): FlattenCandidate[] => {
  candidates.sort((a, b) => {
    const pa = descs[a.descIndex].priority;
    const pb = descs[b.descIndex].priority;
    if (pa !== pb) return pa - pb;
    if (a.descIndex !== b.descIndex) return a.descIndex - b.descIndex;
    if (a.gz !== b.gz) return a.gz - b.gz;
    return a.gx - b.gx;
  });
  const accepted: FlattenCandidate[] = [];
  let pool = candidates;
  for (let round = 0; round < FLATTEN_SPACING_ROUNDS && pool.length > 0; round++) {
    // Drop pool members blocked by prior rounds' winners — permanently out.
    if (round > 0) {
      pool = pool.filter((c) => {
        const fp = descs[c.descIndex].footprint;
        const fpSq = fp * fp;
        for (let i = 0; i < accepted.length; i++) {
          const dx = c.x - accepted[i].x;
          const dz = c.z - accepted[i].z;
          if (dx * dx + dz * dz < fpSq) return false;
        }
        return true;
      });
    }
    const winners: FlattenCandidate[] = [];
    for (let ci = 0; ci < pool.length; ci++) {
      const c = pool[ci];
      const fp = descs[c.descIndex].footprint;
      const fpSq = fp * fp;
      let blocked = false;
      for (let j = 0; j < ci; j++) {
        const dx = c.x - pool[j].x;
        const dz = c.z - pool[j].z;
        if (dx * dx + dz * dz < fpSq) {
          blocked = true;
          break;
        }
      }
      if (!blocked) winners.push(c);
    }
    accepted.push(...winners);
    const winSet = new Set(winners);
    pool = pool.filter((c) => !winSet.has(c));
  }
  return accepted;
};

/** Accepted flatten points whose center lies in the tile — canonical, so every caller sees the identical set. */
const flattenTilePoints = (tx: number, tz: number): FlattenPoint[] => {
  const key = `${tx},${tz}`;
  const hit = flattenTileCache.get(key);
  if (hit) return hit;
  if (flattenTileCache.size > 2048) dropOldestHalf(flattenTileCache);

  const minX = tx * FLATTEN_TILE;
  const minZ = tz * FLATTEN_TILE;
  const maxX = minX + FLATTEN_TILE;
  const maxZ = minZ + FLATTEN_TILE;
  const descs = domainConfig!.flattenDescriptors!;
  const candidates = rollPadCandidates(minX - flattenSpacingPad, minZ - flattenSpacingPad, maxX + flattenSpacingPad, maxZ + flattenSpacingPad, descs);
  const accepted = spacePadCandidates(candidates, descs);

  const points: FlattenPoint[] = [];
  for (const c of accepted) {
    if (c.x < minX || c.x >= maxX || c.z < minZ || c.z >= maxZ) continue; // tile ownership
    const desc = descs[c.descIndex];
    points.push({
      x: c.x,
      z: c.z,
      y: c.y,
      biomeId: c.biomeId,
      descId: desc.id,
      radius: desc.radius,
      skirt: desc.skirt,
    });
  }
  flattenTileCache.set(key, points);
  return points;
};

export function getFlattenPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): FlattenPoint[] {
  if (!domainConfig || !domainConfig.flattenDescriptors || domainConfig.flattenDescriptors.length === 0) return [];
  const out: FlattenPoint[] = [];
  const tx0 = Math.floor(minX / FLATTEN_TILE);
  const tx1 = Math.floor((maxX - 0.001) / FLATTEN_TILE);
  const tz0 = Math.floor(minZ / FLATTEN_TILE);
  const tz1 = Math.floor((maxZ - 0.001) / FLATTEN_TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      for (const p of flattenTilePoints(tx, tz)) {
        if (p.x >= minX && p.x < maxX && p.z >= minZ && p.z < maxZ) out.push(p);
      }
    }
  }
  return out;
}

// Influences apply in ASCENDING mask order so the dominant pad lands last (a dense neighbor's skirt
// would otherwise tilt the footing). Parallel reused buffers, almost always ≤3 entries.
const padInfluenceHeights: number[] = [];
const padInfluenceMasks: number[] = [];
export const applyFlattenPads = (x: number, z: number, height: number): number => {
  let infCount = 0;
  const tx0 = Math.floor((x - flattenReach) / FLATTEN_TILE);
  const tx1 = Math.floor((x + flattenReach) / FLATTEN_TILE);
  const tz0 = Math.floor((z - flattenReach) / FLATTEN_TILE);
  const tz1 = Math.floor((z + flattenReach) / FLATTEN_TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      const points = flattenTilePoints(tx, tz);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const reach = p.radius + p.skirt;
        const dSq = dx * dx + dz * dz;
        if (dSq >= reach * reach) continue;
        const mask = 1 - smoothstep(p.radius, reach, Math.sqrt(dSq));
        // Insertion sort keeps (mask, y) ascending as we go
        let j = infCount++;
        while (
          j > 0 &&
          (padInfluenceMasks[j - 1] > mask || (padInfluenceMasks[j - 1] === mask && padInfluenceHeights[j - 1] > p.y))
        ) {
          padInfluenceMasks[j] = padInfluenceMasks[j - 1];
          padInfluenceHeights[j] = padInfluenceHeights[j - 1];
          j--;
        }
        padInfluenceMasks[j] = mask;
        padInfluenceHeights[j] = p.y;
      }
    }
  }
  for (let i = 0; i < infCount; i++) {
    height += (padInfluenceHeights[i] - height) * padInfluenceMasks[i];
  }
  return height;
};

/** Whether pads can shape a vertex in this biome (only biomes some flatten descriptor targets). */
export const padsApplyIn = (biomeId: number): boolean =>
  !!domainConfig!.flattenDescriptors && domainConfig!.flattenDescriptors.length > 0 && (flattenBiomes === null || flattenBiomes.has(biomeId));

export const initFlattenPads = (config: DomainConfig): void => {
  flattenTileCache.clear();
  flattenCandCache.clear();
  flattenReach = 0;
  flattenSpacingPad = 0;
  flattenBiomes = new Set<number>();
  for (const d of config.flattenDescriptors ?? []) {
    flattenReach = Math.max(flattenReach, d.radius + d.skirt);
    // Round-k spacing decisions depend on ≤ k×footprint neighborhoods.
    flattenSpacingPad = Math.max(flattenSpacingPad, d.footprint * FLATTEN_SPACING_ROUNDS);
    if (d.biomeIds && d.biomeIds.length > 0) {
      for (const b of d.biomeIds) flattenBiomes.add(b);
    } else {
      flattenBiomes = null; // an unrestricted descriptor — pads possible anywhere
    }
    if (flattenBiomes === null) break;
  }
};
