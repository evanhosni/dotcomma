/** Shared helpers for the dressing features' ONE-driver pattern. */

/** The largest value a kind's mounts ask for, since one driver draws them all: a biome asking for
 *  a longer view distance gets it, and no mount is ever drawn shorter than it asked. */
export const farthest = <P,>(mounts: readonly { params: P }[], key: keyof P, fallback: number): number =>
  mounts.reduce((far, { params }) => Math.max(far, (params?.[key] as number | undefined) ?? fallback), 0) || fallback;
