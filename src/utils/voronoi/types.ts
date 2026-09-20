import type { PointXZ } from "../math/types";
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

/** One jittered voronoi site on the horizontal (x/z) world plane and the
 *  element (region / biome) it was assigned. */
export interface VoronoiGrid {
  point: PointXZ;
  element: any;
}

/** A voronoi cell wall: a segment on the horizontal plane between two
 *  circumcenters. Same shape as the inlined pipeline's Wall
 *  (utils/workers/vertexCompute.ts). */
export interface VoronoiWall {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
}

export interface VoronoiGetGridParams {
  seed: string;
  currentVertex: PointXZ;
  cellArray: any[];
  gridSize: number;
  gridFunction: (point: PointXZ, array: any[]) => any;
}

export interface VoronoiGetWallsParams {
  seed: string;
  currentVertex: PointXZ;
  grid: VoronoiGrid[];
  regionGrid: VoronoiGrid[];
  gridSize: number;
}

export interface VoronoiGetDistanceToWallParams {
  currentVertex: PointXZ;
  walls: VoronoiWall[];
}

interface VoronoiCreateParamsBase {
  seed: string;
  /** Horizontal world position to classify (x/z — NOT a screen/plane x/y). */
  currentVertex: PointXZ;
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

export type VoronoiQueue = Array<{
  params: VoronoiCreateParams;
  resolve: (value: any) => void;
}>;
