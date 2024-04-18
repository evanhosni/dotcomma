import { VertexData } from "./VertexData";

export interface Dimension {
  name: string;
  regions: Region[];
  getRegionData: (x: number, y: number, regions: Region[], preventLoop?: boolean) => VertexData; //TODO dimension instead of regions?
  getMaterial: (dimension: Dimension) => Promise<THREE.ShaderMaterial>; //TODO can i get away without needing biomes param?
}

export interface Region {
  name: string; //TODO is this needed?
  biomes: Biome[];
}

export interface Biome {
  name: string;
  id: number;
  getVertexData: (biomeData: VertexData) => VertexData; //TODO separate biomedata and vertexdata? // maybe change to getBiomeVertexData?
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
