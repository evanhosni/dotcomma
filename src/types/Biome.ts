import { Spawner } from "./Spawner";
import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => VertexData;
  getSpawners: (x: number, y: number) => Spawner[];
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
