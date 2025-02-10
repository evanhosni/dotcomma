import * as THREE from "three";
import { utils } from "../utils";
import { VORONOI_FUNCTION, VoronoiCreateParams, VoronoiGetDistanceToWallParams, VoronoiQueue } from "./types";

export const voronoiWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export const terrainVoronoiWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export namespace voronoi {
  let workerBusy = false;
  let workerQueue: VoronoiQueue = [];
  let terrainWorkerBusy = false;
  let terrainWorkerQueue: VoronoiQueue = [];

  export const createWithWorker = async (params: VoronoiCreateParams) => {
    const processNextCreateWork = async () => {
      if (workerQueue.length === 0 || workerBusy) {
        return;
      }

      const nextWork = workerQueue.shift();
      if (!nextWork) return;

      workerBusy = true;
      const { params, resolve } = nextWork;

      voronoiWorker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? utils.getAllBiomesFromRegions(params.regions) : params.biomes;
        const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);

        resolve({ ...event.data, biome });
        workerBusy = false;
        processNextCreateWork();
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
    };

    return new Promise((resolve) => {
      workerQueue.push({ params, resolve });
      processNextCreateWork();
    });
  };

  export const createWithTerrainWorker = async (params: VoronoiCreateParams) => {
    const processNextCreateWork = async () => {
      if (terrainWorkerQueue.length === 0 || terrainWorkerBusy) {
        return;
      }

      const nextWork = terrainWorkerQueue.shift();
      if (!nextWork) return;

      terrainWorkerBusy = true;
      const { params, resolve } = nextWork;

      terrainVoronoiWorker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? utils.getAllBiomesFromRegions(params.regions) : params.biomes;
        const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);

        resolve({ ...event.data, biome });
        terrainWorkerBusy = false;
        processNextCreateWork();
      };

      terrainVoronoiWorker.postMessage({
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
    };

    return new Promise((resolve) => {
      terrainWorkerQueue.push({ params, resolve });
      processNextCreateWork();
    });
  };

  export const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    const vec3 = new THREE.Vector3(currentVertex.x, currentVertex.y, 0); //TODO any way to use vector2 instead?

    var closestPoints = [];
    for (let i = 0; i < walls.length; i++) {
      var closestPoint = new THREE.Vector3(0, 0, 0);
      new THREE.Line3(walls[i].start, walls[i].end).closestPointToPoint(vec3, true, closestPoint);
      closestPoints.push(closestPoint);
    }
    closestPoints.sort((a, b) => a.distanceTo(vec3) - b.distanceTo(vec3));

    return closestPoints[0] ? vec3.distanceTo(closestPoints[0]) : Infinity;
  };
}
