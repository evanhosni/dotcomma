import { TerrainNoiseParams, _noise } from "../../utils/noise/_noise";
import { VertexData, vertexData_default } from "../../world/types";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 5,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 50,
  scale: 200,
};

export const getVertexData = async (biomeData: VertexData) => {
  const { x, y } = biomeData;
  var vertexData: VertexData = { ...vertexData_default, x, y };

  vertexData.height = _noise.terrain(noise, x, y) * -3;

  return vertexData;
};
