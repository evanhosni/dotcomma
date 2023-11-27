export interface BiomeBlend {
  biome?: string; //TODO change string to Biome when u have a Biome type
  value: number;
}

export interface VertexData {
  biome?: string; //TODO change string to Biome when u have a Biome type
  biomeBlending: BiomeBlend[];
  height: number;
}

export const default_vertexData: VertexData = {
  biome: undefined,
  biomeBlending: [],
  height: 0,
};
