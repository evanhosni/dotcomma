/**
 * Where a body of water's PARTS stand (world/water/README.md "Parts"): ONE seeded jittered scatter over a
 * box, kept where the vertex belongs to a body that mounted the part, in the zone the part stands in
 * (./params.ts `waterZoneOf`: submerged, shallows, bank) — dithered by the body's share where two bodies
 * meet. Each point belongs to its grid cell, so chunked queries never duplicate one. The emitters a
 * particle part rises from and the spots an <Actor> in a body stands on (featurePlacement.ts) are both
 * this scatter. Foliage runs the same rule on its own blade grid (foliage.worker.ts). A body kind that
 * knows where its water can lie (its `reachIn`, registered with ../params.ts `registerWaterBodyKind`)
 * spares the scatter the vertices nowhere near it: a pond is a few hundred units in a whole biome.
 * Three-free.
 */

import { seededStream } from "../../../math/seededStream";
import type { RectXZ } from "../../../math/types";
import { domainConfig } from "../../computeConfig";
import { unwarp, warpMax } from "../../noise";
import { computeVertexData } from "../../vertexCompute";
import { waterBodyKind } from "../params";
import { zonedShare } from "./params";
import { pondDiscsIn } from "../ponds";
import { DISC_WIDTH_MAX } from "../rivers";
import type { ZonedBody } from "../types";

/** The boxes the bodies' water can lie in within an area, or null for the whole of it. */
const reachOf = (bodies: readonly ZonedBody[], area: RectXZ): RectXZ[] | null => {
  const boxes: RectXZ[] = [];
  for (const { slot } of bodies) {
    const reach = waterBodyKind(domainConfig!.waterBodies[slot].kind)?.reachIn;
    if (!reach) return null;
    boxes.push(...reach(slot, area));
  }
  return boxes;
};

const inside = (boxes: readonly RectXZ[], x: number, z: number): boolean => boxes.some((b) => x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ);

interface WaterPartParams {
  /** Points per 1,000,000 sq units (of the zone: the scatter covers everything, the zone keeps its own). */
  density: number;
  seedTag: string;
  /** The bodies that mounted the part, each with the zone it stands in there. */
  bodies: ZonedBody[];
}

interface WaterPartPoint {
  x: number;
  z: number;
  /** The ground (the bed under water). */
  floor: number;
  /** The water over it (0 on a bank). */
  depth: number;
  biomeId: number;
}

export const waterPartPointsIn = (minX: number, minZ: number, maxX: number, maxZ: number, params: WaterPartParams): WaterPartPoint[] => {
  const out: WaterPartPoint[] = [];
  if (!domainConfig || params.bodies.length === 0 || !(params.density > 0)) return out;
  const boxes = reachOf(params.bodies, { minX, minZ, maxX, maxZ });
  if (boxes?.length === 0) return out;
  const cell = Math.sqrt(1e6 / params.density);
  const seed = domainConfig.seed;
  for (let gx = Math.floor(minX / cell); gx * cell < maxX; gx++) {
    for (let gz = Math.floor(minZ / cell); gz * cell < maxZ; gz++) {
      const s = seededStream(`${seed}|${params.seedTag}|${gx},${gz}`);
      const x = (gx + s.next()) * cell;
      const z = (gz + s.next()) * cell;
      if (x < minX || x >= maxX || z < minZ || z >= maxZ || (boxes && !inside(boxes, x, z))) continue;
      const vd = computeVertexData(x, z);
      const depth = vd.waterHeight > vd.height ? vd.waterHeight - vd.height : 0;
      const owned = zonedShare(params.bodies, vd, depth);
      if (!(owned > 0) || (owned < 1 && s.next() >= owned)) continue;
      out.push({ x, z, floor: vd.height, depth, biomeId: vd.biomeId });
    }
  }
  return out;
};

export interface WaterEmitterParams extends WaterPartParams {
  /** Water shallower than this gets none (a bubble pops at the surface after depth / rise seconds). */
  minDepth: number;
  /** Particles per emitter. */
  count: number;
}

export interface WaterEmitter {
  x: number;
  /** Just over the bed. */
  y: number;
  z: number;
  /** The water over the bed. */
  depth: number;
  count: number;
}

const OVER_BED = 0.2;

/** The points a particle part (objects/particles/water-bubbles) rises from: its scatter, on the bed under
 *  at least `minDepth` of water. */
export const getWaterEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: WaterEmitterParams): WaterEmitter[] =>
  waterPartPointsIn(minX, minZ, maxX, maxZ, params)
    .filter((p) => p.depth >= params.minDepth)
    .map((p) => ({ x: p.x, y: p.floor + OVER_BED, z: p.z, depth: p.depth, count: params.count }));

export interface PondSurfaceEmitterParams {
  /** Emitters per 1,000,000 sq units of pond water. */
  density: number;
  /** Water shallower than this gets none (the pond's very edge). */
  minDepth: number;
  /** Particles per emitter. */
  count: number;
  seedTag: string;
  /** The bodies that mounted the part (their zones do not apply: it stands on the surface). */
  bodies: ZonedBody[];
}

/** An emitter on a pond's water surface. */
export interface PondSurfaceEmitter {
  x: number;
  /** The water's surface. */
  y: number;
  z: number;
  count: number;
}

/**
 * The points a part rising off a POND's still surface stands on (objects/particles/pond-steam): a seeded
 * jittered scatter over each pond disc (water/ponds: standalone, a river's end or mid-river, a summit's)
 * whose <Pond> mounts the part (FieldDisc.body, the owner of the whole disc), kept where the water is at
 * least `minDepth` deep, on its surface. Never on
 * a river's running water. Each point belongs to the chunk holding it.
 */
export const getPondSurfaceEmitters = (minX: number, minZ: number, maxX: number, maxZ: number, params: PondSurfaceEmitterParams): PondSurfaceEmitter[] => {
  const out: PondSurfaceEmitter[] = [];
  if (!domainConfig || params.bodies.length === 0 || !(params.density > 0)) return out;
  const slots = params.bodies.map((b) => b.slot);
  const hw = domainConfig.river.halfWidth;
  const pad = warpMax() + DISC_WIDTH_MAX * hw;
  const cell = Math.sqrt(1e6 / params.density);
  for (const disc of pondDiscsIn(minX - pad, minZ - pad, maxX + pad, maxZ + pad)) {
    if (!slots.includes(disc.body)) continue;
    const c = unwarp(disc.x, disc.z);
    const r = disc.width * hw * (1 + disc.amount);
    if (c.x + r < minX || c.x - r >= maxX || c.z + r < minZ || c.z - r >= maxZ) continue;
    // The scatter's cells hang off the pond's own centre, so every chunk reads the same points.
    const key = `${domainConfig.seed}|${params.seedTag}|${disc.x.toFixed(2)},${disc.z.toFixed(2)}`;
    const n = Math.ceil(r / cell);
    for (let gx = -n; gx < n; gx++) {
      for (let gz = -n; gz < n; gz++) {
        const s = seededStream(`${key}|${gx},${gz}`);
        const x = c.x + (gx + s.next()) * cell;
        const z = c.z + (gz + s.next()) * cell;
        if (x < minX || x >= maxX || z < minZ || z >= maxZ || Math.hypot(x - c.x, z - c.z) > r) continue;
        const vd = computeVertexData(x, z);
        if (!(vd.waterHeight - vd.height >= params.minDepth)) continue;
        out.push({ x, y: vd.waterHeight, z, count: params.count });
      }
    }
  }
  return out;
};
