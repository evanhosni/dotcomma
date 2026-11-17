import type { ZonedBody } from "../types";

export interface WaterPartParams {
  /** Points per 1,000,000 sq units (of the zone: the scatter covers everything, the zone keeps its own). */
  density: number;
  seedTag: string;
  /** The bodies that mounted the part, each with the zone it stands in there. */
  bodies: ZonedBody[];
}

export interface WaterPartPoint {
  x: number;
  z: number;
  /** The ground (the bed under water). */
  floor: number;
  /** The water over it (0 on a bank). */
  depth: number;
  biomeId: number;
}

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
