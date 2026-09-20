import { DUST_BIOME_ID } from "../../../../../../constants";
import type { BiomeSpec } from "../../../../../../types";

/** The desert dust biome as data — flags + its height definition (folded
 *  perlin dunes, raised 50u). Read by <Biome spec>/<Terrain noise> and the
 *  server's domain config. */
export const DUST_BIOME: BiomeSpec = {
  id: DUST_BIOME_ID,
  name: "dust",
  joinable: true,
  blendable: true,
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
