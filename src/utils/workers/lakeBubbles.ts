/**
 * BUBBLE EMITTERS on the lake bed: a seeded jittered grid over the water biomes' cells (its own
 * scatter — passesPlacementFilters rejects every point under drawn water), kept where the water is at
 * least `minDepth` deep. Each emitter belongs to the grid cell's chunk, so chunked queries never
 * duplicate one. Three-free; the particles themselves are objects/dressing/particles.
 */

import { seededStream } from "../math/seededStream";
import { domainConfig } from "./computeConfig";
import { computeVertexData } from "./vertexCompute";

export interface BubbleEmitterParams {
  /** Emitters per 1,000,000 sq units of lake. */
  density: number;
  seedTag: string;
  /** Water shallower than this gets none (a bubble pops at the surface after depth / rise seconds). */
  minDepth: number;
  /** Particles per emitter. */
  count: number;
}

export interface BubbleEmitter {
  x: number;
  /** Just over the bed. */
  y: number;
  z: number;
  /** The water over the bed. */
  depth: number;
  count: number;
}

const OVER_BED = 0.2;

/** The LIVE config's water biomes (lake cells), in region → biome order. */
export const waterBiomeIds = (): number[] => {
  const ids: number[] = [];
  if (!domainConfig) return ids;
  for (const r of domainConfig.regions) for (const b of r.biomes) if (b.water && !ids.includes(b.id)) ids.push(b.id);
  return ids;
};

export const getLakeBubbleEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: BubbleEmitterParams): BubbleEmitter[] => {
  const out: BubbleEmitter[] = [];
  const water = waterBiomeIds();
  if (!domainConfig || water.length === 0 || !(params.density > 0)) return out;
  const cell = Math.sqrt(1e6 / params.density);
  const seed = domainConfig.seed;
  for (let gx = Math.floor(minX / cell); gx * cell < maxX; gx++) {
    for (let gz = Math.floor(minZ / cell); gz * cell < maxZ; gz++) {
      const s = seededStream(`${seed}|${params.seedTag}|${gx},${gz}`);
      const x = (gx + s.next()) * cell;
      const z = (gz + s.next()) * cell;
      if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
      const vd = computeVertexData(x, z);
      if (!water.includes(vd.biomeId)) continue;
      const depth = vd.waterHeight - vd.height;
      if (!(depth >= params.minDepth)) continue;
      out.push({ x, y: vd.height + OVER_BED, z, depth, count: params.count });
    }
  }
  return out;
};
