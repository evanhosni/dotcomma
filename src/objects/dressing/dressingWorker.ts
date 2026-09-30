/** The client of the ONE dressing worker (utils/workers/dressing.worker.ts). */

import type { CitySitePoint, PlaceInfo, VertexResult } from "../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";
import type { DressingBounds } from "./types";

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
  bounds: DressingBounds,
  args: EnumeratorArgs<K>
): Promise<EnumeratorPoint<K>[]> => request({ type: "ENUMERATE", name, bounds, args });

/** Off-thread because each site can compute a pad tile. */
export const getCityLightSites = (minX: number, minZ: number, maxX: number, maxZ: number): Promise<CitySitePoint[]> =>
  enumerateDressing("cityLightSites", { minX, minZ, maxX, maxZ }, {});

/** Padded height sample off-thread: a flatten-tile miss costs 30–70ms, a lag spike on the main
 *  thread. null until the worker is initialized. (Without `biomeSdf` — a per-vertex scratch field.) */
export const getVertexSample = async (x: number, z: number): Promise<Omit<VertexResult, "biomeSdf"> | null> => {
  const points = await request({ type: "VERTEX_SAMPLE", x, z });
  return (points[0] as Omit<VertexResult, "biomeSdf">) ?? null;
};

/** Where a world point is (region/biome, sky weights, address cell) — the
 *  sky, the stats overlay and the address bar poll this at a low rate. null until the worker is up. */
export const getPlaceInfo = async (x: number, z: number): Promise<PlaceInfo | null> => {
  const points = await request({ type: "PLACE_INFO", x, z });
  return (points[0] as PlaceInfo) ?? null;
};
