import { TerrainParams } from "./types";

export const DEFAULT_RIVER_TEXTURE = "blue_mud.jpg";

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  seed: "123",
  gridSize: 500,
  regionGridSize: 2500,
  boundaryWidth: 14, //NOTE was 12 - width of biome boundary blend offset
  riverWidth: 30, // height suppression zone near region boundaries (rivers)
  defaultBlendWidth: 200, //TODO add noise to blendwidth and make biome dependent
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
