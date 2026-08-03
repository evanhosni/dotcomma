import { Biome, Material, Terrain } from "../../../../world/components";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const DUST_BIOME_ID = 2;

/** Desert biome: dusty dunes. */
export const DustBiome = () => (
  <Biome name="dust" id={DUST_BIOME_ID} joinable blendable>
    <Terrain
      getVertexData={getVertexData}
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
