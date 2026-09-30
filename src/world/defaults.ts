import { TerrainParams } from "./types";

export const DEFAULT_RIVER_TEXTURE = "potato_sack.jpg"; // the desert's sand: riverbeds and banks are sandy

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  seed: "123",
  gridSize: 500,
  // ~6 biome cells across a region.
  regionGridSize: 3000,
  // Wide, soft cross-fades unless a level narrows them (the city biome sets 2).
  defaultBlendWidth: 300,
  defaultHeightBlendWidth: 300,
  roadNoise: {
    type: "perlin",
    octaves: 2,
    persistence: 1,
    lacunarity: 1,
    exponentiation: 1,
    height: 150, //NOTE 100 seems safe
    scale: 250,
  },
  baseNoise: {
    type: "perlin",
    octaves: 3,
    persistence: 2,
    lacunarity: 2,
    exponentiation: 2,
    height: 500,
    scale: 5000,
  },
  river: {
    // A factor-1 river; each river scales it by its width factor (~0.75–2.4, wider toward the ocean).
    halfWidth: 40,
    depth: 9,
    bank: 36,
    defaultProbability: 0.45,
  },
  cityConfig: {
    seed: "city1",
    gridSize: 95,
    roadWidth: 7,
    blockCount: 4,
    maxBlockElevation: 4.5,
    curbHeight: 0.3,
    freewayWidth: 14,
    districtSize: 7.5,
    triangleChance: 0.12,
    roundaboutChance: 0.1,
  },
};

export const DEFAULT_SCENE_BACKGROUND = "#555555";
