import type { BiomeSpec } from "../../../../../../types";

/** Snowy tundra: low frozen ground with shallow hummocks; a modest feather into the snow base. Snow
 *  lies on it and a sparse field of small rocks. */
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
  snow: true,
  rocks: { density: 110, footprint: 6, sizeMin: 0.4, sizeMax: 3, flatKeep: 0.3, startDeg: 8, fullDeg: 25 },
};
