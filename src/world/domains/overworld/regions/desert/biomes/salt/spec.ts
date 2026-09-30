import type { BiomeSpec } from "../../../../../../types";

/** Salt flats: a slightly sunken, almost perfectly level pan (tiny ripples only), fading
 *  up into the sand around it over a wide feather. */
export const SALT_BIOME: BiomeSpec = {
  id: 5,
  name: "salt",
  joinable: true,
  blendWidth: 200,
  noise: {
    params: {
      type: "perlin",
      octaves: 2,
      persistence: 1,
      lacunarity: 2,
      exponentiation: 1,
      height: 6,
      scale: 300,
    },
    offset: -8,
  },
};
