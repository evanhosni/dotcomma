import type { GameObjectAttributes } from "../../objects/types";
import type { WaterZone } from "../water/types";

export interface DensityCandidate {
  x: number;
  z: number;
}

/** The dressing `densityPoints` enumerator's params (objects/dressing/registry.ts). */
export interface DensityPointParams
  extends Pick<GameObjectAttributes, "biomeIds" | "heightRange" | "slopeRange" | "roadDistanceRange"> {
  /** Seed namespace — distinct from spawn-system descriptor ids. */
  seedTag: string;
  /** Instances per 1,000,000 sq units. */
  density: number;
  /** Min spacing between accepted points. */
  footprint: number;
  /** A dressing feature's kind: where `biomeIds` is unset, the points stand in the biomes that
   *  MOUNTED that feature — so no placement anywhere names a biome. */
  feature?: string;
}

/** An <Actor> mounted in a feature, as the spawn worker's descriptor carries it. */
export interface FeatureActor {
  id: string;
  /** The feature's path (ActorPlacement.feature). */
  feature: string;
  density: number;
  /** The biomes that place it. */
  biomeIds?: number[];
  /** Mounted in a body of water: the zone it stands in there (default WATER_ZONE_DEFAULTS.actor). */
  zone?: WaterZone;
}
