import { getAllBiomes } from "../utils";
import { VORONOI_FUNCTION, VoronoiCreateParams, VoronoiGetDistanceToWallParams, VoronoiQueue } from "./types";

// ONE worker: the only voronoi.create callers are Skybox.tsx and Overlay.tsx
// (low-rate biome lookups). Terrain-side voronoi runs inlined inside the
// terrain/spawn/grass workers (workers/vertexCompute.ts) — the old dedicated
// terrain worker and its CREATE_BULK batching path had no callers left and
// were removed (a whole idle Worker was constructed at module import).
export const voronoiWorker = new Worker(new URL("./voronoi.worker.ts", import.meta.url), {
  type: "module",
});

export namespace voronoi {
  let workerBusy = false;
  let workerQueue: VoronoiQueue = [];

  export const create = async (params: VoronoiCreateParams) => {
    const processNextCreateWork = async () => {
      if (workerQueue.length === 0 || workerBusy) {
        return;
      }

      const nextWork = workerQueue.shift();
      if (!nextWork) return;

      workerBusy = true;
      const { params, resolve } = nextWork;

      voronoiWorker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? getAllBiomes(params.regions) : params.biomes;
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
      const ddx = px - cx,
        ddy = py - cy;
      const distSq = ddx * ddx + ddy * ddy;
      if (distSq < minDistSq) minDistSq = distSq;
    }

    return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
  };
}
