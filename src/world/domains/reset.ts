import { resetDressingWorker } from "../../objects/dressing/dressingWorker";
import { resetFoliageWorker } from "../../objects/foliage/foliageWorker";
import { resetSpawnWorker } from "../../objects/actors/spawning/spawnWorker";
import { resetTerrainSystem } from "../terrain/TerrainRenderer";
import { resetActiveDomain } from "./utils";

/**
 * Tear down every module-level system between client-side domain switches.
 * Called by index.tsx in the gap where NO domain/canvas is mounted (two-phase
 * switch: unmount old → reset → mount new), so nothing is using the workers
 * or the active-domain accessors while they reset.
 *
 * Workers are terminated (their in-worker caches die with them) and their
 * client caches cleared; the active domain unpublishes so whenDomainReady()
 * callers block until the incoming domain commits. NOT reset, deliberately:
 *  - main-thread vertexCompute: world/terrain/vertexData.ts re-runs
 *    initCompute when the committed config object changes identity, and
 *    initCompute clears the flatten/city caches itself
 *  - the voronoi worker: stateless per call (params carry regions/seed)
 *  - the collider worker: domain-agnostic geometry → collider transform
 *  - geometry/texture/building-asset caches: keyed by domain-independent or
 *    seed-exact keys, safe (and correct) to reuse
 */
export const resetDomainSystems = () => {
  resetTerrainSystem();
  resetSpawnWorker();
  resetFoliageWorker();
  resetDressingWorker();
  resetActiveDomain();
};
