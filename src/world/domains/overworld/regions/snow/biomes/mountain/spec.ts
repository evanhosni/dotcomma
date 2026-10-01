import type { BiomeSpec } from "../../../../../../types";

/** Mountain massifs: a DOME carries the height — it rises with the square of the depth inside the
 *  mountain, measured across joined cells, so a group of joined cells is ONE mountain whose summit is
 *  where the group is deepest (a lone cell rises to a low hill; the deepest groups reach ~600u in,
 *  hence `reach`). Three slow octaves ride it, faded to `noiseFloor` at the foot: a few big peaks
 *  plus a little ~200u bumpiness on the flanks. The WIDE feather stays: the snow base shows for
 *  a couple of hundred units at the edge and the rock climbs out of it slowly, in material and height
 *  alike (blendWidth governs both). The offset keeps the river network's high-ground rule blocking
 *  rivers out of the rock (relief > 40, riverNetwork.ts). */
export const MOUNTAIN_BIOME: BiomeSpec = {
  id: 7,
  name: "mountain",
  joinable: true,
  blendWidth: 220,
  noise: {
    params: {
      type: "perlin",
      octaves: 3,
      persistence: 0.55,
      lacunarity: 2,
      exponentiation: 2,
      height: 10000,
      scale: 800,
    },
    offset: 70,
    dome: { height: 1500, reach: 600, noiseFloor: 0.25 },
  },
};
