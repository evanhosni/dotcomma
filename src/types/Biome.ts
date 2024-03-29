import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  getVertexData: (biomeData: VertexData) => VertexData; //TODO separate biomedata and vertexdata?
  joinable: boolean;
  blendWidth?: number;
}
