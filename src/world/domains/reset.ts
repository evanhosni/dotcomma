import { resetDressingWorker } from "../../objects/dressing/dressingWorker";
import { resetFoliageWorker } from "../../objects/foliage/foliageWorker";
import { resetSpawnWorker } from "../../objects/actors/spawning/spawnWorker";
import { resetTerrainSystem } from "../terrain/TerrainRenderer";
import { resetActiveDomain } from "./utils";

/** Domain-switch teardown; runs while NO domain is mounted. Deliberately NOT
 *  reset: main-thread vertexCompute (re-inits on config identity change), the
 *  voronoi worker (stateless per call), the collider worker and the
 *  geometry/texture/building-asset caches (domain-independent keys). */
export const resetDomainSystems = () => {
  resetTerrainSystem();
  resetSpawnWorker();
  resetFoliageWorker();
  resetDressingWorker();
  resetActiveDomain();
};
