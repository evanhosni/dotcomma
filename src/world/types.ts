import { TerrainNoiseParams } from "../utils/noise/_noise";

export interface CityConfig {
  seed: string;
  /** Block grid cell size — the scale of one city block (same-index
   *  neighbors merge into larger polyomino blocks). */
  gridSize: number;
  /** Half-width of streets: distance from the road centerline (block
   *  boundary) to the curb. Must match the band constants in the city
   *  fragment shader. */
  roadWidth: number;
  blockCount: number;
  /** Max plateau height of a city block; each block index rolls a seeded
   *  elevation in [0, max]. Roads ramp between neighboring plateaus. */
  maxBlockElevation: number;
  /** How far the road surface sits below the sidewalk (the curb step). */
  curbHeight: number;
  /** Half-width of ARTERIALS — the wide roads along district boundaries,
   *  rendered as scaled-up streets (bands, curb, markers all stretch by
   *  freewayWidth / roadWidth). */
  freewayWidth: number;
  /** Average district size in CELLS. The city is partitioned into staggered
   *  jittered rectangular districts (roughly 0.6–1.4 × this per side); each
   *  district rotates its whole block grid by a seeded multiple of 15°, and
   *  district boundaries carry the arterial roads. */
  districtSize: number;
  /** Probability a 2×2 SUPER-CELL is split by a corner-to-corner diagonal
   *  road into two large flatiron triangle blocks (replacing four normal
   *  blocks). */
  triangleChance: number;
  /** Probability a 2×2 SUPER-CELL becomes a roundabout: a large circular
   *  block (replacing four normal blocks) surrounded by a ring road; the
   *  wrap-around blocks outside the ring copy neighboring labels so they
   *  MERGE with the surrounding grid — only the ring road separates the
   *  neighbors from the island. */
  roundaboutChance: number;
}

/** Global terrain rules — configured by a domain-level <Terrain> component. */
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

/** A biome's height definition — the SINGLE source of truth, evaluated by
 *  the shared vertex pipeline (utils/workers/vertexCompute.ts) on the terrain,
 *  spawn, and grass workers AND the main thread (world/terrain/vertexData.ts). */
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
  /** Per-object spawn class registered by <Actor> components (see
   *  src/world/components/Actor.tsx). Instanced dressing is NOT part of the
   *  biome data model — dressing components render directly. */
  actors?: import("../objects/spawning/types").ActorDescriptor[];
}
