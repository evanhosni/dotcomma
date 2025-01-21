import { Biome, Region } from "../../world/types";

export enum VORONOI_FUNCTION {
  CREATE = "create",
  GET_CURRENT_REGION = "get-current-region",
  GET_CURRENT_REGION_SITE = "get-current-region-site",
  GET_CURRENT_BIOME = "get-current-biome",
  GET_CURRENT_BIOME_SITE = "get-current-biome-site",
  GET_WALLS = "get-walls",
  GET_DISTANCE_TO_WALL = "get-distance-to-wall",
}

export interface VoronoiGrid {
  point: THREE.Vector2;
  element: any;
}

export interface VoronoiGetGridParams {
  seed: string;
  currentVertex: THREE.Vector2;
  cellArray: any[];
  gridSize: number;
  gridFunction: (point: THREE.Vector2, array: any[]) => any;
}

export interface VoronoiGetWallsParams {
  seed: string;
  currentVertex: THREE.Vector2;
  grid: VoronoiGrid[];
  gridSize: number;
}

export interface VoronoiGetDistanceToWallParams {
  currentVertex: THREE.Vector2;
  walls: THREE.Line3[];
}

interface VoronoiCreateParamsBase {
  seed: string;
  currentVertex: THREE.Vector2;
  gridSize: number;
}

interface VoronoiCreateParamsWithBiomes extends VoronoiCreateParamsBase {
  biomes: Biome[];
  regionGridSize?: never;
  regions?: never;
}

interface VoronoiCreateParamsWithRegions extends VoronoiCreateParamsBase {
  biomes?: never;
  regionGridSize: number;
  regions: Region[];
}

export type VoronoiCreateParams = VoronoiCreateParamsWithBiomes | VoronoiCreateParamsWithRegions;
