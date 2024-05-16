import { ScatterGrid } from "../_/_scatter";
import { Dimension } from "./Dimension";
import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => VertexData;
  getSpawners: (dimension: Dimension, x: number, y: number) => ScatterGrid[];
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
