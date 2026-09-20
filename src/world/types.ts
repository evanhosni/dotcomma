import type * as THREE from "three";
import { TerrainNoiseParams } from "../utils/workers/vertexCompute";

/** City terrain knobs — the layout itself is documented in CLAUDE.md. */
export interface CityConfig {
  seed: string;
  /** Block grid cell size. */
  gridSize: number;
  /** Street HALF-width (centerline → curb). Must match the city fragment shader's band constants. */
  roadWidth: number;
  blockCount: number;
  /** Each block index rolls a seeded plateau elevation in [0, max]. */
  maxBlockElevation: number;
  /** Road surface depth below the sidewalk. */
  curbHeight: number;
  /** Arterial (district boundary road) HALF-width. */
  freewayWidth: number;
  /** Average district size in CELLS (actual ~0.6–1.4×). */
  districtSize: number;
  /** Probability a 2×2 super-cell is split by a diagonal road into two flatirons. */
  triangleChance: number;
  /** Probability a 2×2 super-cell becomes a roundabout island + ring road. */
  roundaboutChance: number;
}

export interface TerrainParams {
  seed: string;
  gridSize: number;
  regionGridSize: number;
  boundaryWidth: number;
  riverWidth: number;
  defaultBlendWidth: number;
  roadNoise: TerrainNoiseParams;
  baseNoise: TerrainNoiseParams;
  cityConfig: CityConfig;
}

export interface MaterialData {
  uniforms: any;
  fragmentShader: string;
}

export interface RegionMaterialData {
  biomeTexture: THREE.Texture;
}

/** A biome's height definition — evaluated by the ONE shared pipeline (vertexCompute.ts). */
export interface BiomeNoiseConfig {
  params: TerrainNoiseParams;
  absNeg?: boolean;
  scale?: number;
  offset?: number;
}

/** What a biome folder's `spec.ts` exports — read by the JSX and by the server's shared config. */
export interface BiomeSpec {
  id: number;
  name: string;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
  noise?: BiomeNoiseConfig;
}

export interface Region {
  name: string;
  id: number;
  biomes: Biome[];
  getBoundaryMaterial?: () => Promise<RegionMaterialData>;
}
export interface Biome {
  name: string;
  id: number;
  getMaterial?: () => Promise<MaterialData>;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
  /** Omitted by biomes with bespoke height code (city → branch in vertexCompute.ts). */
  noise?: BiomeNoiseConfig;
  /** Registered by <Actor>; dressing/foliage are not part of the data model. */
  actors?: import("../objects/actors/spawning/types").AnyActorDescriptor[];
}
