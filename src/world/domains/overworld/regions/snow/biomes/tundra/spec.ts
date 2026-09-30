import type { BiomeSpec } from "../../../../../../types";

/** Snowy tundra: low frozen ground with shallow hummocks; a modest feather into the snow base. */
export const TUNDRA_BIOME: BiomeSpec = {
  id: 6,
  name: "tundra",
  joinable: true,
  blendWidth: 120,
  noise: {
    params: {
      type: "perlin",
      octaves: 3,
      persistence: 1,
      lacunarity: 2,
      exponentiation: 1,
      height: 40,
      scale: 260,
    },
  },
};
