import { HOUSE_SPEC } from "../../../../../../../objects/actors/building/spec";
import type { BiomeSpec } from "../../../../../../types";

/** Rolling perlin hills with houses scattered on flatten pads. */
export const GRASS_BIOME: BiomeSpec = {
  id: 3,
  name: "grass",
  joinable: true,
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
  actors: [{ actor: HOUSE_SPEC, density: 30 }],
};
