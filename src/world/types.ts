import { TerrainNoiseParams } from "../utils/noise/_noise";

export interface MaterialData {
  uniforms: any;
  fragmentShader: string;
}

export interface RegionMaterialData {
  biomeTexture: THREE.Texture;
}

/** A biome's height definition — the SINGLE source of truth, evaluated by
 *  the shared vertex pipeline (workers/vertexCompute.ts) on the terrain,
 *  spawn, and grass workers AND the main thread (world/vertexData.ts). */
export interface BiomeNoiseConfig {
  params: TerrainNoiseParams;
  absNeg?: boolean;
  scale?: number;
  offset?: number;
}

export interface Region {
  name: string;
  id: number;
  biomes: Biome[];
  getMaterial?: () => Promise<RegionMaterialData>;
}
export interface Biome {
  name: string;
  id: number;
  getMaterial?: () => Promise<MaterialData>;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
  /** Height definition (see BiomeNoiseConfig). Biomes with bespoke height
   *  logic (city) omit this — their branch lives in vertexCompute.ts. */
  noise?: BiomeNoiseConfig;
  spawnables?: import("../objects/spawning/types").SpawnDescriptor[];
}
