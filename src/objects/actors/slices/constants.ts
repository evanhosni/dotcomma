/** The most slices a body keeps (the server's `state.cuts`): past it, later ones are not taken. */
export const MAX_CUTS = 8;
/** The most bone planes one slice carries (a beeble has ~30 bones). */
export const MAX_CUT_PLANES = 48;
/** A blast bursts a body along this many planes through it (each cuts every bone): several small chunks. */
export const GIB_PLANES = 6;
/** The burst's planes pass this far from the body's middle at most, as a share of its size. */
export const GIB_SPREAD = 0.55;
/** A burst's chunks fly from the blast at up to this (u/s), and spin. */
export const GIB_SPEED = 14;
export const GIB_SPIN = 7;
/** A fresh stump spurts blood this long (s), a spurt every BLEED_INTERVAL. */
export const BLEED_SECONDS = 4;
export const BLEED_INTERVAL = 0.14;
/** Stumps that bleed per body at most (a burst body has dozens). */
export const MAX_BLEEDERS = 8;
/** Bind-space positions closer than this are one point (u): the mesh's seams weld across it. */
export const WELD_PRECISION = 1e-4;
