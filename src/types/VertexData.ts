import { blocks } from "../biomes/city/[blocks]";
import { Biome } from "./Biome";

export interface BiomeBlend {
  biome: Biome;
  value: number;
}

export interface VertexData {
  biome: Biome;
  blendData: BiomeBlend[];
  x: number;
  y: number;
  height: number;
  attributes: any;
}

export const vertexData_default: VertexData = {
  biome: blocks[0],
  blendData: [],
  x: 0,
  y: 0,
  height: 0,
  attributes: {},
};
