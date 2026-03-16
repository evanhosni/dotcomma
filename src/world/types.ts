export interface VertexData {
  x: number;
  y: number;
  height: number;
  attributes: any;
}

export interface MaterialData {
  uniforms: any;
  fragmentShader: string;
}

export interface RegionMaterialData {
  biomeTexture: THREE.Texture;
}

export const vertexData_default: VertexData = {
  x: 0,
  y: 0,
  height: 0,
  attributes: {},
};


export interface Region {
  name: string;
  id: number;
  biomes: Biome[];
  getMaterial?: () => Promise<RegionMaterialData>;
}
export interface Biome {
  name: string;
  id: number;
  getVertexData: (vertexData: VertexData) => Promise<VertexData>;
  getMaterial?: () => Promise<MaterialData>;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
  spawnables?: import("../objects/spawning/types").SpawnDescriptor[];
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

