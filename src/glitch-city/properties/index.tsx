import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData, default_vertexData } from "../../types/VertexData";
import { CityProperties } from "./City";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 20,
  scale: 50,
};

const vertexData: VertexData = default_vertexData;

const getVertexData = (x: number, y: number) => {
  vertexData.biome = "test";
  return vertexData;
};

export const GlitchCityProperties = {
  vertexData: (x: number, y: number) => getVertexData(x, y),

  getHeight: (x: number, y: number) => {
    if (_noise.terrain(noise, x, y) > 10) {
      return _noise.terrain(noise, x, y);
    } else {
      return CityProperties.getHeight(x, y);
    }
  },

  getMaterial: (x: number, y: number) => {
    return "material";
  },
};
