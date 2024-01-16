import { TerrainNoiseParams, _noise } from "../../../_/noise";
import { VertexData, vertexData_default } from "../../../types/VertexData";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 3,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 50,
  scale: 200,
};

export const getVertexData = (x: number, y: number) => {
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  vertexData.height = Math.abs(_noise.terrain(noise, x, y)) * -1;

  return vertexData;
};
