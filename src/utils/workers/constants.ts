/** Constants a worker and its client (or the server) must agree on. Three-free, dependency-free. */

/** World units per spawn chunk: the spawn worker caches and answers by `${cx}_${cz}` keys of this
 *  grid, and its client (objects/actors/spawning/spawnWorker.ts) builds the keys and the chunk
 *  centers its cache eviction measures from. */
export const SPAWN_CHUNK_SIZE = 250;
