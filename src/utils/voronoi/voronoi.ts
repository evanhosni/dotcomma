import { getAllBiomes } from "../utils";
import { VORONOI_FUNCTION, VoronoiCreateParams, VoronoiQueue } from "./types";

// ONE worker, created LAZILY on the first lookup: the only voronoi.create
// callers are Skybox.tsx and Overlay.tsx (low-rate biome lookups), so an eager
// module-import Worker sat idle on the home page. Terrain-side voronoi runs
// inlined inside the terrain/spawn/grass workers (utils/workers/vertexCompute.ts).
// The worker is stateless per call (params carry regions/seed), so it is not
// reset on domain switches.
let voronoiWorker: Worker | null = null;
const getWorker = (): Worker =>
  (voronoiWorker ??= new Worker(new URL("./voronoi.worker.ts", import.meta.url), { type: "module" }));

export namespace voronoi {
  let workerBusy = false;
  let workerQueue: VoronoiQueue = [];

  const serializeBiomes = (biomes: VoronoiCreateParams["biomes"]) =>
    biomes?.map((biome) => ({
      name: biome.name,
      id: biome.id,
      joinable: biome.joinable,
      blendable: biome.blendable,
      blendWidth: biome.blendWidth,
    }));

  export const create = async (params: VoronoiCreateParams) => {
    const processNextCreateWork = async () => {
      if (workerQueue.length === 0 || workerBusy) {
        return;
      }

      const nextWork = workerQueue.shift();
      if (!nextWork) return;

      workerBusy = true;
      const { params, resolve } = nextWork;
      const worker = getWorker();

      worker.onmessage = (event) => {
        const biomes_in_use = params.regions?.length ? getAllBiomes(params.regions) : params.biomes;
        const biome = biomes_in_use?.find((b) => b.id === event.data.biome.id);

        resolve({ ...event.data, biome });
        workerBusy = false;
        processNextCreateWork();
      };

      worker.postMessage({
        type: VORONOI_FUNCTION.CREATE,
        params: {
          seed: params.seed,
          currentVertex: params.currentVertex,
          gridSize: params.gridSize,
          regionGridSize: params.regionGridSize,
          regions: params.regions?.map((region) => ({ biomes: serializeBiomes(region.biomes) })),
          biomes: serializeBiomes(params.biomes),
        },
      });
    };

    return new Promise((resolve) => {
      workerQueue.push({ params, resolve });
      processNextCreateWork();
    });
  };
}
