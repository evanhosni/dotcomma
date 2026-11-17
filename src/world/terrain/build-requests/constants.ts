import { TERRAIN_WORKER_COUNT } from "../worker";

/** Worker requests kept in flight, the chunk being finished included. A worker handles one message at a
 *  time, so with a single request it idled from posting each result until the next frame's pass asked for
 *  the next chunk, and through every main-thread stall (a shader link during the load is 100s of ms). */
export const REQUESTS_IN_FLIGHT = TERRAIN_WORKER_COUNT * 2 + 1;
/** While the terrain gate is closed the player is held at the spawn, so the build order cannot change and a
 *  deep queue costs nothing; it carries the worker through the load's shader links (each 300–700ms). */
export const LOADING_REQUESTS_IN_FLIGHT = 16;
