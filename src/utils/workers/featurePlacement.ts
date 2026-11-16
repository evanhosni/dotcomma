import type { RectXZ } from "../math/types";
import type { WaterZone } from "./water/types";
import { reportContentError } from "../contentError";
import { sewerSideRoomsIn } from "./underground/districts";
import { caveSideRoomsIn } from "./underground/systems";
import { CAVE_ROOMS, SEWER_ROOMS } from "./underground/params";
import { bodyOf } from "./water/params";
import { WATER_ZONE_DEFAULTS } from "./water/parts/params";
import { waterPartPointsIn } from "./water/parts";

/** Where a feature stands the actors of an <Actor> mounted inside it, by the feature's PATH: the
 *  floor point of each place it holds in the area. Three-free — the spawn worker runs on a
 *  serialized config, so a function cannot ride along on the declaration and this table is how a
 *  path reaches its placement. The keys are built from the declarations' own kinds, so renaming a
 *  component cannot silently orphan one. */
const FEATURE_PLACEMENTS: Record<string, (biomeId: number, area: RectXZ) => { x: number; z: number; floor: number }[]> = {
  [SEWER_ROOMS]: sewerSideRoomsIn,
  [CAVE_ROOMS]: caveSideRoomsIn,
};

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

/** Where a feature-placed actor stands in an area. In a BODY of water (its path is the body's id, the one
 *  a biome placing it carries: water/params.ts bodyOf) it is the body's parts' one scatter, at its own
 *  density, in its zone; else the feature's own places. */
export const featurePlacesIn = (actor: FeatureActor, area: RectXZ): { x: number; z: number; floor: number; biomeId: number }[] => {
  const biomeIds = actor.biomeIds ?? [];
  const slots = [...new Set(biomeIds.map((b) => bodyOf(b, actor.feature)).filter((s) => s >= 0))];
  if (slots.length > 0) {
    const zone = actor.zone ?? WATER_ZONE_DEFAULTS.actor;
    const bodies = slots.map((slot) => ({ slot, zone }));
    return waterPartPointsIn(area.minX, area.minZ, area.maxX, area.maxZ, { density: actor.density, seedTag: actor.id, bodies });
  }
  const place = FEATURE_PLACEMENTS[actor.feature];
  if (!place) {
    reportContentError(`an <Actor> is mounted in the "${actor.feature}" feature, which places no actors — add its placement to FEATURE_PLACEMENTS (utils/workers/featurePlacement.ts)`);
    return [];
  }
  return biomeIds.flatMap((biomeId) => place(biomeId, area).map((p) => ({ ...p, biomeId })));
};
