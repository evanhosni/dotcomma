/**
 * Foliage placement worker (every plant type): coarse terrain grid + bilinear
 * interpolation per instance.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "GENERATE_FOLIAGE", id: number, chunkX: number, chunkZ: number, params: FoliageChunkParams, band: number }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "FOLIAGE_RESULT", id, count, total, minY, maxY, offsets: Float32Array, instanceData: Float32Array }
 *        (`count` = the band's prefix of the `total` placed blades)
 */

import type { FoliageChunkParams } from "../../objects/foliage/foliageWorker";
import { seedRand, smoothstep } from "../math/_math";
import { RIVER_BED_FULL_INSET } from "../../world/shaders/constants";
import { DomainConfig, initCompute, computeVertexData, biomeWeightOf, riverKeepOff } from "./vertexCompute";

const GRID_STEP = 2; // world units between terrain samples
// Same visibility floor as the terrain shader's per-biome branch.
const MIN_BIOME_WEIGHT = 0.002;
// 64u chunks at the grass field's 8M density place ~32k blades per chunk.
const MAX_INSTANCES_PER_CHUNK = 65536;
const INSTANCE_SINK = 0.15; // bury blade bases slightly to hide interpolation error
// Plants thin out over this many riverBedDistance units (factor-1, like the shader's bed edge):
// none where the bed fully covers the ground, full density this far past it — the bed stays bare
// and only a sparse fringe reaches its fade.
const RIVER_BED_PLANT_RAMP = 8;
// Stored in place of an out-of-reach Infinity: a bilinear weight of 0 times Infinity is NaN.
const RIVER_BED_FAR = 1e4;

let initialized = false;

/** A per-blade uniform in [0, 1) from the chunk seed and the blade's draw index — NOT a draw from
 *  the PRNG stream (an extra draw would reshuffle every later blade of the chunk) and not from
 *  phase/tint (the fade key is made of those; thinning by it would bias the LOD prefix). */
const bladeHash = (seed: number, index: number): number => {
  let h = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Fast deterministic PRNG — one seedrandom call per chunk, cheap draws per blade. */
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Reused across chunks: a 32k-blade chunk needs ~2.5MB of scratch per request.
const SCRATCH_OFFSETS = new Float32Array(MAX_INSTANCES_PER_CHUNK * 3);
const SCRATCH_BLADE_DATA = new Float32Array(MAX_INSTANCES_PER_CHUNK * 3);
const SCRATCH_FADE_KEYS = new Float32Array(MAX_INSTANCES_PER_CHUNK);
const SCRATCH_ORDER = new Uint32Array(MAX_INSTANCES_PER_CHUNK);

// ~8 blades per bucket at 32k blades; keys are a well-mixed hash, so buckets stay small.
const FADE_BUCKETS = 4096;
const INSERTION_SORT_MAX = 64;
const bucketCounts = new Uint32Array(FADE_BUCKETS);
const bucketEnds = new Uint32Array(FADE_BUCKETS);

const bucketOf = (key: number): number => Math.min(FADE_BUCKETS - 1, (key * FADE_BUCKETS) | 0);

/**
 * Writes the first `count` blades of the DESCENDING fade-key order into `out`, ties in
 * placement order — exactly what a stable sort of all `placed` blades begins with, so any
 * shorter band is a strict prefix of a longer one. O(placed + count): buckets below the
 * cut are never ordered.
 */
const orderByFadeKey = (keys: Float32Array, placed: number, count: number, out: Uint32Array): void => {
  if (count <= 0) return;
  bucketCounts.fill(0);
  for (let i = 0; i < placed; i++) bucketCounts[bucketOf(keys[i])]++;
  let cut = 0;
  let end = 0;
  for (let b = FADE_BUCKETS - 1; b >= 0; b--) {
    bucketEnds[b] = end; // segment START until the scatter below advances it to the end
    end += bucketCounts[b];
    if (end >= count) {
      cut = b;
      break;
    }
  }
  for (let i = 0; i < placed; i++) {
    const b = bucketOf(keys[i]);
    if (b >= cut) out[bucketEnds[b]++] = i;
  }
  let start = 0;
  for (let b = FADE_BUCKETS - 1; b >= cut && start < count; b--) {
    const segEnd = bucketEnds[b];
    if (segEnd - start <= INSERTION_SORT_MAX) {
      // Stable: strict < keeps equal keys in placement order.
      for (let j = start + 1; j < segEnd; j++) {
        const v = out[j];
        const kv = keys[v];
        let k = j - 1;
        while (k >= start && keys[out[k]] < kv) {
          out[k + 1] = out[k];
          k--;
        }
        out[k + 1] = v;
      }
    } else {
      out.subarray(start, segEnd).sort((a, c) => keys[c] - keys[a] || a - c);
    }
    start = segEnd;
  }
};

interface FoliageGrid {
  gridNodes: number;
  heights: Float32Array;
  slopes: Float32Array;
  biomeWeights: Float32Array;
  roadDistances: Float32Array;
  submerged: Float32Array; // 1 where the water surface sits above the ground (lake, river channel)
  riverBed: Float32Array; // riverBedDistance, capped at RIVER_BED_FAR
  nearRiverBed: boolean; // some node inside the plant ramp: only then is it evaluated per blade
}

// A BAND upgrade of a held chunk re-runs placement (the RNG stream is the only way to reach
// its blades) but not the ~1,100 terrain samples: the grid is kept here. 256 × ~22KB ≈ 5.6MB
// covers every chunk a 500u field holds; a miss only costs the resample.
const GRID_CACHE_MAX = 256;
const gridCache = new Map<string, FoliageGrid>();

const sampleGrid = (minX: number, minZ: number, size: number, biomeIds: number[] | undefined): FoliageGrid => {
  const gridNodes = Math.floor(size / GRID_STEP) + 1;
  const heights = new Float32Array(gridNodes * gridNodes);
  const slopes = new Float32Array(gridNodes * gridNodes);
  const biomeWeights = new Float32Array(gridNodes * gridNodes);
  const roadDistances = new Float32Array(gridNodes * gridNodes);
  const submerged = new Float32Array(gridNodes * gridNodes);
  const riverBed = new Float32Array(gridNodes * gridNodes);
  const rampEnd = riverKeepOff() - RIVER_BED_FULL_INSET + RIVER_BED_PLANT_RAMP;
  let nearRiverBed = false;

  for (let gz = 0; gz < gridNodes; gz++) {
    for (let gx = 0; gx < gridNodes; gx++) {
      const vd = computeVertexData(minX + gx * GRID_STEP, minZ + gz * GRID_STEP);
      const i = gz * gridNodes + gx;
      heights[i] = vd.height;
      biomeWeights[i] = biomeIds ? biomeWeightOf(vd.biomeSdf, biomeIds) : 1;
      roadDistances[i] = vd.distanceToRoadCenter;
      // Nor under a bridge deck: the ground there is cut just below the deck's top.
      submerged[i] = (!Number.isNaN(vd.waterHeight) && vd.waterHeight > vd.height - 0.3) || vd.underDeck > 0 ? 1 : 0;
      riverBed[i] = Math.min(vd.riverBedDistance, RIVER_BED_FAR);
      if (riverBed[i] < rampEnd) nearRiverBed = true;
    }
  }

  for (let gz = 0; gz < gridNodes; gz++) {
    for (let gx = 0; gx < gridNodes; gx++) {
      const x0 = Math.max(gx - 1, 0);
      const x1 = Math.min(gx + 1, gridNodes - 1);
      const z0 = Math.max(gz - 1, 0);
      const z1 = Math.min(gz + 1, gridNodes - 1);
      const dhdx = (heights[gz * gridNodes + x1] - heights[gz * gridNodes + x0]) / ((x1 - x0) * GRID_STEP);
      const dhdz = (heights[z1 * gridNodes + gx] - heights[z0 * gridNodes + gx]) / ((z1 - z0) * GRID_STEP);
      slopes[gz * gridNodes + gx] = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
    }
  }
  return { gridNodes, heights, slopes, biomeWeights, roadDistances, submerged, riverBed, nearRiverBed };
};

const takeCachedGrid = (key: string): FoliageGrid | undefined => {
  const hit = gridCache.get(key);
  if (hit) {
    gridCache.delete(key); // re-insert = most recently used
    gridCache.set(key, hit);
  }
  return hit;
};

const cacheGrid = (key: string, grid: FoliageGrid): void => {
  if (gridCache.size >= GRID_CACHE_MAX) gridCache.delete(gridCache.keys().next().value!);
  gridCache.set(key, grid);
};

/** Whether any of `biomeIds` is visible (terrain material weight) at the chunk's center or corners:
 *  if not, there is nothing to place. */
const biomesVisibleInChunk = (minX: number, minZ: number, size: number, biomeIds: number[]): boolean => {
  for (const [px, pz] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) {
    const vd = computeVertexData(minX + px * size, minZ + pz * size);
    if (biomeWeightOf(vd.biomeSdf, biomeIds) > MIN_BIOME_WEIGHT) return true;
  }
  return false;
};

/** The first `count` placed blades in DESCENDING per-instance fade key (the shader's
 *  fract(phase * 1.618 + tint * 12.9898)), copied out of the scratch: the main thread truncates
 *  instanceCount to the blades whose fade hasn't zeroed. The LOD taper silently biases if this order
 *  changes. */
const packByFadeKey = (placed: number, count: number): { offsets: Float32Array; instanceData: Float32Array } => {
  const offsets = SCRATCH_OFFSETS;
  const instanceData = SCRATCH_BLADE_DATA;
  const fadeKey = SCRATCH_FADE_KEYS;
  for (let i = 0; i < placed; i++) {
    const v = instanceData[i * 3] * 1.618 + instanceData[i * 3 + 2] * 12.9898;
    fadeKey[i] = v - Math.floor(v);
  }
  const order = SCRATCH_ORDER;
  orderByFadeKey(fadeKey, placed, count, order);
  const outOffsets = new Float32Array(count * 3);
  const outBladeData = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    outOffsets[k * 3] = offsets[i * 3];
    outOffsets[k * 3 + 1] = offsets[i * 3 + 1];
    outOffsets[k * 3 + 2] = offsets[i * 3 + 2];
    outBladeData[k * 3] = instanceData[i * 3];
    outBladeData[k * 3 + 1] = instanceData[i * 3 + 1];
    outBladeData[k * 3 + 2] = instanceData[i * 3 + 2];
  }
  return { offsets: outOffsets, instanceData: outBladeData };
};

const EMPTY_RESULT = () => ({
  count: 0,
  total: 0,
  minY: 0,
  maxY: 0,
  offsets: new Float32Array(0),
  instanceData: new Float32Array(0),
});

/**
 * Places the chunk and returns the first `ceil(total × band)` blades of the fade-key order
 * (`count` of `total`). Placement always runs in full — `total`, minY/maxY and every blade's
 * values are band-independent — so a band's blades are exactly the same-rank blades of any
 * wider band: a strict prefix, which is what lets a chunk be widened without a pop.
 */
export const generateChunk = (chunkX: number, chunkZ: number, params: FoliageChunkParams, band = 1) => {
  const size = params.chunkSize;
  const minX = chunkX * size;
  const minZ = chunkZ * size;

  // Blades follow the terrain material's BIOME WEIGHT (the cross-fade), not the cell
  // id: a hard stop on the cell line under a 300u texture fade would read as an edge.
  const hasBiomes = !!params.biomeIds && params.biomeIds.length > 0;
  const biomeIds = hasBiomes ? params.biomeIds : undefined;
  const gridKey = `${size}|${biomeIds ? biomeIds.join(",") : ""}|${chunkX},${chunkZ}`;
  let grid = takeCachedGrid(gridKey); // only non-empty chunks are cached: a hit skips the probe
  if (!grid) {
    if (biomeIds && !biomesVisibleInChunk(minX, minZ, size, biomeIds)) return EMPTY_RESULT();
    grid = sampleGrid(minX, minZ, size, biomeIds);
    cacheGrid(gridKey, grid);
  }
  const { gridNodes, heights, slopes, biomeWeights, roadDistances, submerged, riverBed, nearRiverBed } = grid;
  const bedCovered = riverKeepOff() - RIVER_BED_FULL_INSET;

  // One bilinear cell per blade, shared by every field it samples (the arithmetic is
  // term-for-term the per-field version's, so the samples are bit-identical).
  let i00 = 0;
  let i01 = 0;
  let tx = 0;
  let tz = 0;
  const setCell = (x: number, z: number): void => {
    const fx = Math.min(Math.max((x - minX) / GRID_STEP, 0), gridNodes - 1);
    const fz = Math.min(Math.max((z - minZ) / GRID_STEP, 0), gridNodes - 1);
    const x0 = Math.min(Math.floor(fx), gridNodes - 2);
    const z0 = Math.min(Math.floor(fz), gridNodes - 2);
    tx = fx - x0;
    tz = fz - z0;
    i00 = z0 * gridNodes + x0;
    i01 = (z0 + 1) * gridNodes + x0;
  };
  const bilinear = (arr: Float32Array): number =>
    (arr[i00] * (1 - tx) + arr[i00 + 1] * tx) * (1 - tz) + (arr[i01] * (1 - tx) + arr[i01 + 1] * tx) * tz;

  const targetCount = Math.min(Math.round((params.density * size * size) / 1_000_000), MAX_INSTANCES_PER_CHUNK);
  const chunkSeed = Math.floor(seedRand(`grass_${params.seed}_${chunkX}_${chunkZ}`) * 2 ** 31);
  const rand = mulberry32(chunkSeed);

  const offsets = SCRATCH_OFFSETS;
  const instanceData = SCRATCH_BLADE_DATA; // phase, scale, tint
  let placed = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < targetCount; i++) {
    const x = minX + rand() * size;
    const z = minZ + rand() * size;
    const phase = rand() * Math.PI * 2;
    let scale = 0.7 + rand() * 0.6;
    const tint = rand();
    setCell(x, z);

    if (hasBiomes) {
      // Density dithers down and blades shorten with the biome's fading weight.
      const w = bilinear(biomeWeights);
      if (w <= MIN_BIOME_WEIGHT) continue;
      if (w < 1) {
        if (rand() >= w) continue;
        scale *= 0.6 + 0.4 * w;
      }
    }

    const height = bilinear(heights);
    if (params.heightRange) {
      if (height < params.heightRange[0] || height > params.heightRange[1]) continue;
    }
    if (bilinear(submerged) > 0.25) continue;
    if (params.roadDistanceRange) {
      const road = bilinear(roadDistances);
      if (road < params.roadDistanceRange[0] || road > params.roadDistanceRange[1]) continue;
    }

    if (params.slopeRange) {
      // Soft edges: density dithers down and blades shorten across the blend band.
      const slope = bilinear(slopes);
      const [minSlope, maxSlope] = params.slopeRange;
      const blend = Math.max(params.slopeBlend, 0.001);
      let keep = 1 - smoothstep(maxSlope - blend, maxSlope, slope);
      if (minSlope > 0) keep *= smoothstep(minSlope, minSlope + blend, slope);
      if (keep <= 0) continue;
      if (keep < 1) {
        if (rand() >= keep) continue;
        scale *= 0.6 + 0.4 * keep;
      }
    }

    // LAST, after every filter that draws from `rand`: a blade it drops must not skip a draw, or
    // every later blade of the chunk would reshuffle — the river only ever REMOVES blades.
    if (nearRiverBed) {
      // The riverbed paint's own field and edge (the terrain shader's riverBlend).
      const keep = smoothstep(bedCovered, bedCovered + RIVER_BED_PLANT_RAMP, bilinear(riverBed));
      if (keep < 1) {
        if (keep <= 0 || bladeHash(chunkSeed, i) >= keep) continue;
        scale *= 0.6 + 0.4 * keep;
      }
    }

    const y = height - INSTANCE_SINK;
    offsets[placed * 3] = x;
    offsets[placed * 3 + 1] = y;
    offsets[placed * 3 + 2] = z;
    instanceData[placed * 3] = phase;
    instanceData[placed * 3 + 1] = scale;
    instanceData[placed * 3 + 2] = tint;
    placed++;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const count = Math.min(placed, Math.ceil(placed * band));
  const packed = packByFadeKey(placed, count);
  return {
    count,
    total: placed,
    // Over ALL placed blades, so the chunk's culling sphere doesn't change with its band.
    minY: placed > 0 ? minY : 0,
    maxY: placed > 0 ? maxY : 0,
    offsets: packed.offsets,
    instanceData: packed.instanceData,
  };
};

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "GENERATE_FOLIAGE") {
    const { id, chunkX, chunkZ, params, band } = e.data;
    if (!initialized) {
      (self as any).postMessage({ type: "FOLIAGE_RESULT", id, ...EMPTY_RESULT() });
      return;
    }

    const result = generateChunk(chunkX, chunkZ, params, band);
    (self as any).postMessage({ type: "FOLIAGE_RESULT", id, ...result }, [
      result.offsets.buffer,
      result.instanceData.buffer,
    ]);
    return;
  }
};
