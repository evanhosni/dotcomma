import { seedRand } from ".";

/** A sequence of seeded rolls: ONE seedRand roll seeds an integer mulberry32, so every thread and the
 *  server draw the same numbers from the same string. A system draws its layout and its decoration from
 *  SEPARATE streams (`…|layout`, `…|decor`), so decoration never moves a passage. */
export interface SeededStream {
  /** [0, 1). */
  next(): number;
  between(min: number, max: number): number;
  /** −1 or +1 (a sign; `between(-a, a)` for a magnitude). */
  signedUnit(): number;
  /** Integer in [min, max]. */
  intBetween(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A Fisher–Yates shuffled copy. */
  shuffled<T>(items: readonly T[]): T[];
}

export const seededStream = (seed: string): SeededStream => {
  let a = Math.floor(seedRand(seed) * 2 ** 31) | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (min: number, max: number): number => min + (max - min) * next();
  return {
    next,
    between,
    signedUnit: () => (next() < 0.5 ? -1 : 1),
    intBetween: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffled: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    },
  };
};
