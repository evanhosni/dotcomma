import { GRASS_BIOME_ID } from "../../../../../../constants";
import type { BiomeSpec } from "../../../../../../types";

/** The grassland biome as data — flags + the ONE height definition (rolling
 *  perlin). <Biome spec> and <Terrain noise> read it in every region that
 *  mounts grass (the city region re-exports this file), and the server's
 *  domain config lists it, so the numbers can't drift between them. */
export const GRASS_BIOME: BiomeSpec = {
  id: GRASS_BIOME_ID,
  name: "grass",
  joinable: true,
  blendable: true,
  noise: {
    params: {
      type: "perlin",
      octaves: 3,
      persistence: 1,
      lacunarity: 1,
      exponentiation: 1,
      height: 100,
      scale: 100,
    },
  },
};
