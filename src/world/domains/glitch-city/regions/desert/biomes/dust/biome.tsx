import { Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";

import { DUST_BIOME_ID } from "../../../../../../constants";
export { DUST_BIOME_ID };

/** Desert biome: dusty dunes. */
export const DustBiome = () => (
  <Biome name="dust" id={DUST_BIOME_ID} joinable blendable>
    <Terrain
      noise={{
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
      }}
    />
    <Material getMaterial={getMaterial} />
  </Biome>
);
