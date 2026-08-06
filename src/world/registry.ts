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
