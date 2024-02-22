import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData, vertexData_default } from "../../types/VertexData";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 5,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 50,
  scale: 200,
};

export const getVertexData = (biomeData: VertexData) => {
  const { x, y } = biomeData;
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  vertexData.height = _noise.terrain(noise, x, y) * -3;

  return vertexData;
};
