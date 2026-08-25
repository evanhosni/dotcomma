import seedrandom from "seedrandom";

/** The world's master seed salt. Every deterministic roll in the project —
 *  terrain, voronoi, spawns, flatten pads, dressing — goes through seedRand
 *  below, so this is the ONE string that defines "the same world". It used to
 *  be spelled in two files (here and vertexCompute.ts) that silently had to
 *  agree. Worker-safe: no THREE/DOM imports in this module. */
export const MASTER_SEED = "mynamebierce";

/** Deterministic [0, 1) roll for a seed string (fresh seedrandom per call). */
export const seedRand = (seed: any): number => seedrandom(seed + MASTER_SEED)();

/** GLSL-semantics smoothstep: 0 below edge0, 1 above edge1, Hermite between. */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (x: number, min: number, max: number): number => Math.min(Math.max(x, min), max);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Namespace form, kept for the existing `_math.seedRand(...)` call sites. */
export namespace _math {
  export const seedRand = (seed: any): number => seedrandom(seed + MASTER_SEED)();
}
