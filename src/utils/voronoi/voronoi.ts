import { utils } from "../utils";
import { VORONOI_FUNCTION, VoronoiCreateParams, VoronoiGetDistanceToWallParams } from "./types";

export const voronoiCreateWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export const voronoiGetDistanceToWallWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export namespace voronoi {
  export const create = async (params: VoronoiCreateParams) => {
    return new Promise((resolve) => {
      voronoiCreateWorker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? utils.getAllBiomesFromRegions(params.regions) : params.biomes;
        const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);
        resolve({ ...event.data, biome });
      };

      voronoiCreateWorker.postMessage({
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
      voronoiGetDistanceToWallWorker.onmessage = (event) => {
        resolve(event.data);
      };

      voronoiGetDistanceToWallWorker.postMessage({
        type: VORONOI_FUNCTION.GET_DISTANCE_TO_WALL,
        params,
      });
    });
  };
}
