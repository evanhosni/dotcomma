/** The client of the ONE dressing worker (utils/workers/dressing.worker.ts). */

import type { MovementModifiers, SurfaceFetch } from "../../physics/movementModifiers";
import type { CitySitePoint, PlaceInfo, VertexResult } from "../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";
import type { ChunkBounds } from "./types";

export type { CitySitePoint, PlaceInfo };

const client = createWorkerClient({
  create: () =>
    new Worker(new URL("../../utils/workers/dressing.worker.ts", import.meta.url), { type: "module" }),
  init: async () => {
    await whenDomainReady();
    return { config: getActiveDomainConfig() };
  },
  resultType: "DRESSING_RESULT",
});

/** In-flight requests never resolve after a reset — their callers unmounted with the old domain. */
export const resetDressingWorker = client.reset;

const request = (message: Record<string, unknown>): Promise<any[]> =>
  client.request<{ points: any[] }>(message).then((r) => r.points);

/** Run the named enumerator (objects/dressing/enumerators.ts) over one chunk, off-thread. */
export const enumerateDressing = <K extends DressingEnumeratorName>(
  name: K,
  bounds: ChunkBounds,
  args: EnumeratorArgs<K>
): Promise<EnumeratorPoint<K>[]> => request({ type: "ENUMERATE", name, bounds, args });

/** Off-thread because each site can compute a pad tile. */
export const getCityLightSites = (minX: number, minZ: number, maxX: number, maxZ: number): Promise<CitySitePoint[]> =>
  enumerateDressing("cityLightSites", { minX, minZ, maxX, maxZ }, {});

/** A height sample off-thread, PADDED (the real surface) or `raw` (pad-free: the water, which pads never
 *  stand in, and the ground under bridge decks). On the main thread a flatten-tile miss costs 30–70ms and
 *  a cell's first river list and road network ~70ms: a frame spike while flying. null until the worker is
 *  initialized. (Without `biomeSdf` — a per-vertex scratch field.) */
export const getVertexSample = async (x: number, z: number, options: { raw?: boolean } = {}): Promise<Omit<VertexResult, "biomeSdf"> | null> => {
  const points = await request({ type: "VERTEX_SAMPLE", x, z, raw: !!options.raw });
  return (points[0] as Omit<VertexResult, "biomeSdf">) ?? null;
};

/** The movement modifiers at a world point (physics/movementModifiers.ts: the snow's drag and
 *  traction), for a capsule's surface sampler (`createSurfaceSampler`). null until the worker is up —
 *  neutral ground. */
export const fetchSurfaceModifiers: SurfaceFetch = (x, z, feetY, answer) => {
  request({ type: "SURFACE", x, z, feetY }).then(
    (points) => answer((points[0] as MovementModifiers | undefined) ?? null),
    () => answer(null),
  );
};

/** Where a world point is (region/biome, sky weights, address cell) and the ground there
 *  (utils/workers/ground.ts) — world/place.ts polls it for the player. null until the worker is up. */
export const getPlaceInfo = async (x: number, z: number): Promise<(PlaceInfo & { ground: string }) | null> => {
  const points = await request({ type: "PLACE_INFO", x, z });
  return (points[0] as PlaceInfo & { ground: string }) ?? null;
};
