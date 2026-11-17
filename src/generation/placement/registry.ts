import type { RectXZ } from "../../utils/math/types";
import { reportContentError } from "../../utils/utils";
import { sewerSideRoomsIn } from "../underground/sewers/utils";
import { caveSideRoomsIn } from "../underground";
import { CAVE_ROOMS, SEWER_ROOMS } from "../underground/params";
import { bodyOf } from "../water/params";
import { WATER_ZONE_DEFAULTS } from "../water/parts/params";
import { waterPartPointsIn } from "../water/parts";
import type { FeatureActor } from "./types";

/** Where a feature stands the actors of an <Actor> mounted inside it, by the feature's PATH: the
 *  floor point of each place it holds in the area. Three-free — the spawn worker runs on a
 *  serialized config, so a function cannot ride along on the declaration and this table is how a
 *  path reaches its placement. The keys are built from the declarations' own kinds, so renaming a
 *  component cannot silently orphan one. */
const FEATURE_PLACEMENTS: Record<string, (biomeId: number, area: RectXZ) => { x: number; z: number; floor: number }[]> = {
  [SEWER_ROOMS]: sewerSideRoomsIn,
  [CAVE_ROOMS]: caveSideRoomsIn,
};

/** Where a feature-placed actor stands in an area. In a BODY of water (its path is the body's id, the one
 *  a biome placing it carries: generation/water/params.ts bodyOf) it is the body's parts' one scatter, at its own
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
