/**
 * Biome ids the SHARED pipeline branches on.
 *
 * Most biome ids only matter to the biome's own component. The city's id is
 * different: the height pipeline (vertexCompute.ts), the dressing worker's
 * chunk probe and the city dressing features all test for it, and each used
 * to spell a bare `1`. Workers cannot import from a biome folder (that would
 * drag React components into the worker bundle), so the ids live here, at
 * world level, and each biome's `biome.tsx` re-exports its own.
 */
export const CITY_BIOME_ID = 1;
export const DUST_BIOME_ID = 2;
export const GRASS_BIOME_ID = 3;
export const WIRE_BIOME_ID = 4;
