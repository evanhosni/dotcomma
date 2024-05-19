import { Region } from "./Region";
import { VertexData } from "./VertexData";

export interface Dimension {
  name: string;
  regions: Region[];
  getVertexData: (x: number, y: number, regions: Region[]) => VertexData; //TODO dimension instead of regions?
  getMaterial: (dimension: Dimension) => Promise<THREE.ShaderMaterial>;
  getSpawners: (dimension: Dimension, x: number, y: number) => { point: THREE.Vector3; element: any }[]; //TODO maybe this should work more like getMaterial. It should take in a dimension parameter and be called from a controller script, much like Terrain.tsx
}
