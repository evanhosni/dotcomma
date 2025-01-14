import * as THREE from "three";
import { _utils } from "../../_/_utils";
import { Biome } from "../../types/Biome";
import { Region } from "../../types/Region";
import { VORONOI_FUNCTION } from "./voronoiWorker";

export interface VoronoiGrid {
  point: THREE.Vector2;
  element: any;
}

interface VoronoiGetGridParams {
  seed: string;
  currentVertex: THREE.Vector2;
  cellArray: any[];
  gridSize: number;
  gridFunction: (point: THREE.Vector2, array: any[]) => any;
}

interface VoronoiGetWallsParams {
  seed: string;
  currentVertex: THREE.Vector2;
  grid: VoronoiGrid[];
  gridSize: number;
}

interface VoronoiGetDistanceToWallParams {
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

export const voronoiWorker = new Worker(new URL("./voronoiWorker.ts", import.meta.url), {
  type: "module",
});

export namespace voronoi {
  export const create = async (params: VoronoiCreateParams) => {
    return new Promise((resolve) => {
      voronoiWorker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? _utils.getAllBiomesFromRegions(params.regions) : params.biomes;
        if (!event.data.biome) console.log(event); //TODO occassionally line 61 errors because event.data.biome is undefined. This is because for some reason it is returning the wrong promise from the worker, it is somehow getting out of order and returning the event.data from the below function, getDistanceToWall, which is just a number
        const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);
        resolve({ ...event.data, biome });
      };

      voronoiWorker.postMessage({
        type: VORONOI_FUNCTION.CREATE,
        params: {
          seed: params.seed,
          currentVertex: params.currentVertex,
          gridSize: params.gridSize,
          regionGridSize: params.regionGridSize,
          regions: params.regions?.map((region) => ({
            biomes: region.biomes.map((biome) => ({
              name: biome.name,
              id: biome.id,
              joinable: biome.joinable,
              blendable: biome.blendable,
              blendWidth: biome.blendWidth,
            })),
          })),
          biomes: params.biomes?.map((biome) => ({
            name: biome.name,
            id: biome.id,
            joinable: biome.joinable,
            blendable: biome.blendable,
            blendWidth: biome.blendWidth,
          })),
        },
      });
    });
  };

  export const getDistanceToWall = async (params: VoronoiGetDistanceToWallParams): Promise<number> => {
    return new Promise((resolve) => {
      voronoiWorker.onmessage = (event) => {
        resolve(event.data);
      };

      // console.log(params);

      voronoiWorker.postMessage({
        type: VORONOI_FUNCTION.GET_DISTANCE_TO_WALL,
        params,
      });
    });
  };
}
