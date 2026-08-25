/**
 * Grass blade placement worker.
 *
 * Generates deterministic per-chunk grass blade transforms off the main
 * thread. Samples the shared vertex pipeline on a coarse grid, then bilinearly
 * interpolates height/slope per blade — far cheaper than one computeVertexData
 * call per blade.
 *
 * Messages:
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "GENERATE_FOLIAGE", id: number, chunkX: number, chunkZ: number, params: FoliageChunkParams }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "FOLIAGE_RESULT", id, count, minY, maxY, offsets: Float32Array, instanceData: Float32Array }
 */

import { DomainConfig, initCompute, computeVertexData, seedRand } from "./vertexCompute";
import { smoothstep } from "../math/_math";

const GRID_STEP = 2; // world units between terrain samples
const MAX_INSTANCES_PER_CHUNK = 16384;
const INSTANCE_SINK = 0.15; // bury blade bases slightly to hide interpolation error

// ── Inline params type (mirrors FoliageChunkParams in foliage/grass/grassWorker.ts) ──

interface FoliageChunkParams {
  seed: string;
  chunkSize: number;
  density: number; // blades per 1,000,000 sq units
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number]; // degrees
  slopeBlend: number; // degrees over which density fades at the slopeRange edges
}

let initialized = false;

/** Fast deterministic PRNG — one seedrandom call per chunk, cheap draws per blade. */

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const EMPTY_RESULT = () => ({
  count: 0,
  minY: 0,
  maxY: 0,
  offsets: new Float32Array(0),
  instanceData: new Float32Array(0),
});

const generateChunk = (chunkX: number, chunkZ: number, params: FoliageChunkParams) => {
  const size = params.chunkSize;
  const minX = chunkX * size;
  const minZ = chunkZ * size;

  // ── Emptiness pre-probe (mirrors cityDressing.worker's probeEmpty) ──
  // One computeVertexData at the chunk center: when the center is outside
  // every requested biome AND farther from the biome boundary than the
  // chunk's half-diagonal (size × 0.75 > size × √2/2), no point in the chunk
  // can be in a requested biome — every blade would fail the biome filter, so
  // skip the (n×n)-sample terrain grid + blade loop entirely. Output for
  // non-empty chunks is untouched (the probe only ever returns the same
  // empty result the full loop would have produced).
  if (params.biomeIds && params.biomeIds.length > 0) {
    const vd = computeVertexData(minX + size / 2, minZ + size / 2);
    if (!params.biomeIds.includes(vd.biomeId) && vd.distanceToBiomeBoundaryCenter > size * 0.75) {
      return EMPTY_RESULT();
    }
  }

  // ── Coarse terrain grid: height, biome, slope (degrees) per node ──
  const n = Math.floor(size / GRID_STEP) + 1;
  const heights = new Float32Array(n * n);
  const slopes = new Float32Array(n * n);
  const biomeIds = new Int32Array(n * n);

  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const vd = computeVertexData(minX + gx * GRID_STEP, minZ + gz * GRID_STEP);
      heights[gz * n + gx] = vd.height;
      biomeIds[gz * n + gx] = vd.biomeId;
    }
  }

  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x0 = Math.max(gx - 1, 0);
      const x1 = Math.min(gx + 1, n - 1);
      const z0 = Math.max(gz - 1, 0);
      const z1 = Math.min(gz + 1, n - 1);
      const dhdx = (heights[gz * n + x1] - heights[gz * n + x0]) / ((x1 - x0) * GRID_STEP);
      const dhdz = (heights[z1 * n + gx] - heights[z0 * n + gx]) / ((z1 - z0) * GRID_STEP);
      slopes[gz * n + gx] = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
    }
  }

  const bilinear = (arr: Float32Array, x: number, z: number): number => {
    const fx = Math.min(Math.max((x - minX) / GRID_STEP, 0), n - 1);
    const fz = Math.min(Math.max((z - minZ) / GRID_STEP, 0), n - 1);
    const x0 = Math.min(Math.floor(fx), n - 2);
    const z0 = Math.min(Math.floor(fz), n - 2);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = arr[z0 * n + x0];
    const h10 = arr[z0 * n + x0 + 1];
    const h01 = arr[(z0 + 1) * n + x0];
    const h11 = arr[(z0 + 1) * n + x0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  // ── Blade placement ──
  const count = Math.min(Math.round((params.density * size * size) / 1_000_000), MAX_INSTANCES_PER_CHUNK);
  const rand = mulberry32(Math.floor(seedRand(`grass_${params.seed}_${chunkX}_${chunkZ}`) * 2 ** 31));

  const offsets = new Float32Array(count * 3);
  const instanceData = new Float32Array(count * 3); // phase, scale, tint
  let placed = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = minX + rand() * size;
    const z = minZ + rand() * size;
    const phase = rand() * Math.PI * 2;
    let scale = 0.7 + rand() * 0.6;
    const tint = rand();

    if (params.biomeIds && params.biomeIds.length > 0) {
      const gx = Math.min(Math.max(Math.round((x - minX) / GRID_STEP), 0), n - 1);
      const gz = Math.min(Math.max(Math.round((z - minZ) / GRID_STEP), 0), n - 1);
      if (!params.biomeIds.includes(biomeIds[gz * n + gx])) continue;
    }

    const height = bilinear(heights, x, z);
    if (params.heightRange) {
      if (height < params.heightRange[0] || height > params.heightRange[1]) continue;
    }

    if (params.slopeRange) {
      // soft edges: density dithers down and blades shorten across the blend
      // band instead of cutting off at the exact slope limit
      const slope = bilinear(slopes, x, z);
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

  // ── Sort blades by DESCENDING fade key ──
  // The shader gives every blade its own fade-out distance from
  // fract(phase * 1.618 + tint * 12.9898) (see GRASS_VERTEX_SHADER): past it
  // the blade is invisible but still costs full vertex work. With instances
  // ordered longest-lived first, the main thread can truncate a far chunk's
  // instanceCount to just the blades whose fade hasn't zeroed them — instance
  // order has no other meaning, so this is visually free.
  const order: number[] = new Array(placed);
  const fadeKey = new Float32Array(placed);
  for (let i = 0; i < placed; i++) {
    order[i] = i;
    const v = instanceData[i * 3] * 1.618 + instanceData[i * 3 + 2] * 12.9898;
    fadeKey[i] = v - Math.floor(v);
  }
  order.sort((a, b) => fadeKey[b] - fadeKey[a]);
  const outOffsets = new Float32Array(placed * 3);
  const outBladeData = new Float32Array(placed * 3);
  for (let k = 0; k < placed; k++) {
    const i = order[k];
    outOffsets[k * 3] = offsets[i * 3];
    outOffsets[k * 3 + 1] = offsets[i * 3 + 1];
    outOffsets[k * 3 + 2] = offsets[i * 3 + 2];
    outBladeData[k * 3] = instanceData[i * 3];
    outBladeData[k * 3 + 1] = instanceData[i * 3 + 1];
    outBladeData[k * 3 + 2] = instanceData[i * 3 + 2];
  }

  return {
    count: placed,
    minY: placed > 0 ? minY : 0,
    maxY: placed > 0 ? maxY : 0,
    offsets: outOffsets,
    instanceData: outBladeData,
  };
};

// ── Message Handler ──

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "GENERATE_FOLIAGE") {
    const { id, chunkX, chunkZ, params } = e.data;
    if (!initialized) {
      (self as any).postMessage({
        type: "FOLIAGE_RESULT",
        id,
        count: 0,
        minY: 0,
        maxY: 0,
        offsets: new Float32Array(0),
        instanceData: new Float32Array(0),
      });
      return;
    }

    const result = generateChunk(chunkX, chunkZ, params);
    (self as any).postMessage({ type: "FOLIAGE_RESULT", id, ...result }, [
      result.offsets.buffer,
      result.instanceData.buffer,
    ]);
    return;
  }
};
