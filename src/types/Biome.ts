import { Dimension } from "./Dimension";
import { Spawner } from "./Spawner";
import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => VertexData;
  getSpawners: (dimension: Dimension) => Spawner[];
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
