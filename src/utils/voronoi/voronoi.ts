import { Dust } from "../../biomes/dust/Dust";
import { City } from "../../biomes/city/City";
import { Grass } from "../../biomes/grass/Grass";
import { Pharmasea } from "../../biomes/pharma/Pharma";
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

  const MAX_BATCH_SIZE = 10;

  export const create = async (params: VoronoiCreateParams) => {
    if (params.isTerrain) {
      const processNextCreateWork = async () => {
        if (terrainWorkerQueue.length === 0 || terrainWorkerBusy) {
          return;
        }

        const batchSize = Math.min(MAX_BATCH_SIZE, terrainWorkerQueue.length);
        const nextWorkBatch = terrainWorkerQueue.splice(0, batchSize);

        terrainWorkerBusy = true;

        const resolves = nextWorkBatch.map(({ resolve }) => resolve);

        terrainVoronoiWorker.onmessage = (event) => {
          if (event.data.type === VORONOI_FUNCTION.CREATE_BULK && Array.isArray(event.data.results)) {
            //TODO keeping this check temporarily.
            event.data.results.forEach((result: any, index: number) => {
              if (index < resolves.length) {
                const biomes_in_use = [City, Grass, Dust, Pharmasea]; // TODO const somewhere else or other solution, maybe context
                const biome = biomes_in_use.find((b) => b.id === result.biome.id);
                resolves[index]({ ...result, biome });
              }
            });

            terrainWorkerBusy = false;
            processNextCreateWork();
          } else {
            //TODO keeping this check temporarily. i doubt this will ever error so eventually remove the unnecessary check
            console.error("error in voronoi.ts");
          }
        };

        const bulkParams = nextWorkBatch.map(({ params }) => ({
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
        }));

        terrainVoronoiWorker.postMessage({
          type: VORONOI_FUNCTION.CREATE_BULK,
          params: bulkParams,
        });
      };

      return new Promise((resolve) => {
        terrainWorkerQueue.push({ params, resolve });
        processNextCreateWork();
      });
    } else {
      const processNextCreateWork = async () => {
        if (workerQueue.length === 0 || workerBusy) {
          return;
        }

        const nextWork = workerQueue.shift();
        if (!nextWork) return;

        workerBusy = true;
        const { params, resolve } = nextWork;

        voronoiWorker.onmessage = (event) => {
          const biomes_in_use = params.regions?.length ? utils.getAllBiomes(params.regions) : params.biomes;
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
    }
  };

  export const getDistanceToWall = ({ currentVertex, walls }: VoronoiGetDistanceToWallParams): number => {
    const px = currentVertex.x,
      py = currentVertex.y;
    let minDistSq = Infinity;

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const ax = wall.start.x,
        ay = wall.start.y;
      const bx = wall.end.x,
        by = wall.end.y;

      const dx = bx - ax,
        dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const cx = ax + t * dx,
        cy = ay + t * dy;
      const ddx = px - cx, ddy = py - cy;
      const distSq = ddx * ddx + ddy * ddy;
      if (distSq < minDistSq) minDistSq = distSq;
    }

    return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
  };
}
