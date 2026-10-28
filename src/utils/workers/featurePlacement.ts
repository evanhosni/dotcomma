import type { RectXZ } from "../math/types";
import { reportContentError } from "../contentError";
import { sewerSideRoomsIn } from "./underground/districts";
import { caveSideRoomsIn } from "./underground/systems";
import { CAVE_ROOMS, SEWER_ROOMS } from "./underground/params";

/** Where a feature stands the actors of an <Actor> mounted inside it, by the feature's PATH: the
 *  floor point of each place it holds in the area. Three-free — the spawn worker runs on a
 *  serialized config, so a function cannot ride along on the declaration and this table is how a
 *  path reaches its placement. The keys are built from the declarations' own kinds, so renaming a
 *  component cannot silently orphan one. */
const FEATURE_PLACEMENTS: Record<string, (biomeId: number, area: RectXZ) => { x: number; z: number; floor: number }[]> = {
  [SEWER_ROOMS]: sewerSideRoomsIn,
  [CAVE_ROOMS]: caveSideRoomsIn,
};

export const featurePlacesIn = (path: string, biomeId: number, area: RectXZ): { x: number; z: number; floor: number }[] => {
  const place = FEATURE_PLACEMENTS[path];
  if (!place) {
    reportContentError(`an <Actor> is mounted in the "${path}" feature, which places no actors — add its placement to FEATURE_PLACEMENTS (utils/workers/featurePlacement.ts)`);
    return [];
  }
  return place(biomeId, area);
};
