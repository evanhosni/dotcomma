import type { BiomeSpec } from "../../../../../../types";

/** Folded perlin dunes, raised 50u. */
export const DUST_BIOME: BiomeSpec = {
  id: 2,
  name: "dust",
  joinable: true,
  noise: {
    params: {
      type: "perlin",
      octaves: 3,
      persistence: 1,
      lacunarity: 1,
      exponentiation: 1,
      height: 150,
      scale: 200,
    },
    absNeg: true,
    offset: 50,
  },
};
