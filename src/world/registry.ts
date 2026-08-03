import { TerrainNoiseParams } from "../utils/noise/_noise";
import { WorldConfig } from "../workers/vertexCompute";
import { Region } from "./types";

/**
 * Module-level "active world" registry.
 *
 * The <World> component tree registers regions/biomes/rules declaratively and
 * commits the assembled data here. Non-React code (worker init, the voronoi
 * client, Player raycasts, terrain material composition) reads from this
 * registry instead of importing a static WORLD_REGIONS list.
 */

export interface CityWorkerConfig {
  seed: string;
  gridSize: number;
  roadWidth: number;
  blockCount: number;
}

/** Global terrain rules — configured by a world-level <Terrain> component. */
export interface WorldTerrainParams {
  seed: string;
  gridSize: number;
  regionGridSize: number;
  boundaryWidth: number;
  riverWidth: number;
  defaultBlendWidth: number;
  roadNoise: TerrainNoiseParams;
  baseNoise: TerrainNoiseParams;
  cityConfig: CityWorkerConfig;
}

export const DEFAULT_WORLD_TERRAIN_PARAMS: WorldTerrainParams = {
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
    gridSize: 100,
    roadWidth: 10,
    blockCount: 4,
  },
};

export interface ActiveWorld {
  regions: Region[];
  params: WorldTerrainParams;
  config: WorldConfig;
  riverTexture: string;
}

let active: ActiveWorld | null = null;
let resolveReady: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

/** Called by <World> on every commit (registrations changed). */
export const setActiveWorld = (world: ActiveWorld) => {
  active = world;
  if (resolveReady) {
    resolveReady();
    resolveReady = null;
  }
};

/** Resolves once the first <World> commit has happened. */
export const whenWorldReady = (): Promise<void> => readyPromise;

export const isWorldReady = (): boolean => active !== null;

export const getActiveRegions = (): Region[] => active?.regions ?? [];

export const getWorldTerrainParams = (): WorldTerrainParams => active?.params ?? DEFAULT_WORLD_TERRAIN_PARAMS;

export const getWorldRiverTexture = (): string => active?.riverTexture ?? "blue_mud.jpg";

/** Serializable config for terrain/spawn/grass workers. Only valid after commit. */
export const getActiveWorldConfig = (): WorldConfig => {
  if (!active) {
    throw new Error("getActiveWorldConfig() called before <World> committed — await whenWorldReady() first");
  }
  return active.config;
};
