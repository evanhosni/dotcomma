export interface VertexData {
  x: number;
  y: number;
  height: number;
  attributes: any;
}

export const vertexData_default: VertexData = {
  x: 0,
  y: 0,
  height: 0,
  attributes: {},
};

export interface Dimension {
  name: string;
  regions: Region[];
  getVertexData: (x: number, y: number, isTerrain?: boolean) => Promise<VertexData>;
  getMaterial: () => Promise<THREE.ShaderMaterial>;
  component: () => JSX.Element;
}

export interface Region {
  biomes: Biome[];
}

export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => Promise<VertexData>;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}

export interface Block {
  name: string;
  joinable: boolean;
  components: any[]; //TODO typing
}

export const block_default = {
  name: "",
  joinable: false,
  components: [],
};

export interface Spawner {
  point: THREE.Vector3;
  element: any;
}
