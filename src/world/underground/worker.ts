/** The client of the tunnel worker (utils/workers/underground.worker.ts): its own thread, so a chunk's
 *  100–400ms never blocks the dressing worker's enumerations. A client file is only typed wrappers. */

import type { MouthPiece, TunnelStyle, UndergroundChunk } from "../../utils/workers/underground/types";
import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig, whenDomainReady } from "../domains/utils";
import type { ChunkBounds } from "../chunks/types";

const client = createWorkerClient({
  create: () => new Worker(new URL("../../utils/workers/underground.worker.ts", import.meta.url), { type: "module" }),
  init: async () => {
    await whenDomainReady();
    return { config: getActiveDomainConfig() };
  },
  resultType: "UNDERGROUND_RESULT",
});

/** In-flight requests never resolve after a reset — their callers unmounted with the old domain. */
export const resetUndergroundWorker = client.reset;

/** One chunk's tunnels, or null when nothing of the style reaches it (also on a worker failure). */
export const buildUndergroundChunk = (bounds: ChunkBounds, style: TunnelStyle, biomeId: number): Promise<UndergroundChunk | null> =>
  client.request<{ chunk: UndergroundChunk | null }>({ type: "BUILD_UNDERGROUND", bounds, style, biomeId }).then((r) => r.chunk ?? null);

/** Every cave mouth whose system reaches an area (the far impostors). */
export const fetchCaveMouths = (area: ChunkBounds): Promise<MouthPiece[]> =>
  client.request<{ mouths: MouthPiece[] }>({ type: "CAVE_MOUTHS", area }).then((r) => r.mouths ?? []);
