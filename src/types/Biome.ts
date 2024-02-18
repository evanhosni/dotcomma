import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  getVertexData: (x: number, y: number) => VertexData;
}
