import type { BiomeSpec } from "../../../../../../types";

/** Mountain massifs: a DOME carries the height — it rises with the square of the depth inside the
 *  mountain, measured across joined cells, so a group of joined cells is ONE mountain whose summit is
 *  where the group is deepest (a lone cell rises to a low hill; the deepest groups reach ~600u in,
 *  hence `reach`). Two slow octaves ride it, faded to `noiseFloor` at the foot, for a few big peaks
 *  on top instead of four octaves of mid-sized ones. The WIDE feather stays: the snow base shows for
 *  a couple of hundred units at the edge and the rock climbs out of it slowly, in material and height
 *  alike (blendWidth governs both). It must stay under half a biome cell (gridSize 500): presence
 *  peaks at the cell center, and a 450u feather never reached 0.5 there. The offset keeps the river
 *  network's high-ground rule blocking rivers out of the rock (relief > 40, riverNetwork.ts). */
export const MOUNTAIN_BIOME: BiomeSpec = {
  id: 7,
  name: "mountain",
  joinable: true,
  blendWidth: 220,
  noise: {
    params: {
      type: "perlin",
      octaves: 2,
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
