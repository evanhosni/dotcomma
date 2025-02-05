import * as THREE from "three";
import { utils } from "../utils";
import { VORONOI_FUNCTION, VoronoiCreateParams, VoronoiGetDistanceToWallParams } from "./types";

export const voronoiCreateWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export namespace voronoi {
  let isCreateWorkerBusy = false;
  let createWorkQueue: Array<{
    params: VoronoiCreateParams;
    resolve: (value: any) => void;
  }> = [];

  const processNextCreateWork = async () => {
    if (createWorkQueue.length === 0 || isCreateWorkerBusy) {
      return;
    }

    const nextWork = createWorkQueue.shift();
    if (!nextWork) return;

    isCreateWorkerBusy = true;
    const { params, resolve } = nextWork;

    voronoiCreateWorker.onmessage = (event) => {
      const biomes_in_use = params.regions?.length ? utils.getAllBiomesFromRegions(params.regions) : params.biomes;
      const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);

      resolve({ ...event.data, biome });
      isCreateWorkerBusy = false;
      processNextCreateWork();
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
  };

  export const create = async (params: VoronoiCreateParams) => {
    return new Promise((resolve) => {
      createWorkQueue.push({ params, resolve });
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
