import { Spawner } from "./Spawner";
import { VertexData } from "./VertexData";

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => Promise<VertexData>;
  getSpawners: (x: number, y: number) => Promise<Spawner[]>;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}
