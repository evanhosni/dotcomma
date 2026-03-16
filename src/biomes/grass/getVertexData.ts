import { TerrainNoiseParams, _noise } from "../../utils/noise/_noise";
import { VertexData, vertexData_default } from "../../world/types";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 3,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 100,
  scale: 100,
};

export const getVertexData = async (biomeData: VertexData) => {
  const { x, y } = biomeData;
  var vertexData: VertexData = { ...vertexData_default, x, y };

  vertexData.height = _noise.terrain(noise, x, y);

  return vertexData;
};
