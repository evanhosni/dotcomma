import { Dimension } from "./Dimension";
import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => VertexData;
  getSpawners: (dimension: Dimension, x: number, y: number) => THREE.Vector3[];
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
