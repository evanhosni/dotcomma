import { resetDressingWorker } from "../../objects/dressing/dressingWorker";
import { resetFarMouths } from "../../objects/dressing/underground/farMouths";
import { resetUndergroundWorker } from "../../objects/dressing/underground/undergroundWorker";
import { resetFoliageWorker } from "../../objects/foliage/foliageWorker";
import { resetSpawnWorker } from "../../objects/actors/spawning/spawnWorker";
import { resetSpriteWorkers } from "../../objects/sprite-lod/spriteWorker";
import { resetTerrainSystem } from "../terrain/TerrainRenderer";
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
