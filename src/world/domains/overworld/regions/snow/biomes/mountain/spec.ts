import type { BiomeSpec } from "../../../../../../types";

/** Mountain tops: squared perlin so the mass rises in peaks, with a WIDE feather — the
 *  snow base shows for a couple of hundred units at the edge and the rock climbs out of it
 *  slowly, in material and in height alike (blendWidth governs both). The feather must stay
 *  under half a biome cell (gridSize 500): presence peaks at the cell center, and a 450u
 *  feather never reached 0.5 there — measured 14u peaks with a 900u/900 noise, which also
 *  varied too little across one cell (terrainNoise squares a ±0.5 value, so a 900 height is
 *  a 225 ceiling and ~10 typical). */
export const MOUNTAIN_BIOME: BiomeSpec = {
  id: 7,
  name: "mountain",
  joinable: true,
  blendWidth: 220,
  noise: {
    params: {
      type: "perlin",
      octaves: 4,
      persistence: 0.55,
      lacunarity: 2,
      exponentiation: 2,
      height: 2600,
      scale: 380,
    },
    offset: 70,
  },
};
