import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  borderWidth: number;
  getVertexData: (x: number, y: number) => VertexData;
}
