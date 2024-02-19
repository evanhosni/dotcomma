import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData, vertexData_default } from "../../types/VertexData";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 3,
  persistence: 20,
  lacunarity: 3,
  exponentiation: 3,
  height: 400,
  scale: 80,
};

export const getVertexData = (x: number, y: number) => {
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  vertexData.height = _noise.terrain(noise, x, y) * -3 - 80;

  return vertexData;
};
