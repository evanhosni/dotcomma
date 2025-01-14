import { Region } from "./Region";
import { Spawner } from "./Spawner";
import { VertexData } from "./VertexData";

export interface Dimension {
  name: string;
  regions: Region[];
  getVertexData: (x: number, y: number) => Promise<VertexData>;
  getMaterial: () => Promise<THREE.ShaderMaterial>;
  getSpawners: (x: number, y: number) => Promise<Spawner[]>;
  component: () => JSX.Element;
}
