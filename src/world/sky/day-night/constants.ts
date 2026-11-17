export const SUN_DISTANCE = 5000;
export const SUN_SIZE = 1000; // silhouette radius, world units
export const SUN_ROUNDNESS = 0.75; // 1 = perfect circle, 0 = very irregular blob
export const SUN_VERTICES_COUNT = 10; // rim vertices — fewer = chunkier
export const MOON_DISTANCE = 5000;
export const MOON_SIZE = 1000;
export const MOON_ROUNDNESS = 1; // 1 = clean crescent arcs, 0 = very irregular
export const MOON_VERTICES_COUNT = 19; // total boundary vertices across both arcs
export const STAR_DISTANCE = 5600;
export const STAR_COUNT = 550;

export const JITTER_INTERVAL_S = 0.09;
export const JITTER_AMPLITUDE = 0.07; // × radius, per tick, per vertex
export const QUANT_BASE = 0.13; // × radius — the exaggerated quantization grid
export const QUANT_DEGRADE = 0.55;
