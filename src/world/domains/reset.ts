import { resetDressingWorker } from "../../objects/dressing/worker";
import { resetFarMouths } from "../underground/farMouths";
import { resetUndergroundWorker } from "../underground/worker";
import { resetFoliageWorker } from "../../objects/foliage/worker";
import { resetSpawnWorker } from "../../objects/actors/spawning/worker";
import { resetSpriteWorkers } from "../../objects/sprite-lod/worker";
import { resetTerrainSystem } from "../terrain";
import { resetActiveDomain } from "./utils";

/** Domain-switch teardown; runs while NO domain is mounted. Deliberately NOT
 *  reset: main-thread vertexCompute (re-inits on config identity change), the
 *  collider worker and the geometry/texture/building-asset caches
 *  (domain-independent keys). */
export const resetDomainSystems = () => {
  resetTerrainSystem();
  resetSpawnWorker();
  resetSpriteWorkers();
  resetFoliageWorker();
  resetDressingWorker();
  resetUndergroundWorker();
  resetFarMouths();
  resetActiveDomain();
};
