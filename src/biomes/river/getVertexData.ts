import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData, vertexData_default } from "../../types/VertexData";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 3,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 5,
  scale: 2,
};

export const getVertexData = (x: number, y: number) => {
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  vertexData.height = _noise.terrain(noise, x, y) - 25;

  return vertexData;
};
