import seedrandom from "seedrandom";

/** The ONE string that defines "the same world": every deterministic roll goes through seedRand. */
export const MASTER_SEED = "mynamebierce";

export const seedRand = (seed: any): number => seedrandom(seed + MASTER_SEED)();

/** GLSL-semantics smoothstep: 0 below edge0, 1 above edge1, Hermite between. */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (x: number, min: number, max: number): number => Math.min(Math.max(x, min), max);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export namespace _math {
  export const seedRand = (seed: any): number => seedrandom(seed + MASTER_SEED)();
}
