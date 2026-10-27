import type { RectXZ } from "../math/types";
import { reportContentError } from "../contentError";
import { sewerSideRoomsIn } from "./underground/districts";
import { caveSideRoomsIn } from "./underground/systems";

/** Where a feature stands the actors of a <Spawn> mounted inside it (world/features.ts), by the
 *  feature's path: the floor point of each place it holds in the area. Three-free (the spawn worker). */
const FEATURE_PLACEMENTS: Record<string, (biomeId: number, area: RectXZ) => { x: number; z: number; floor: number }[]> = {
  "sewers.sideRooms": sewerSideRoomsIn,
  "caves.sideRooms": caveSideRoomsIn,
};

export const featurePlacesIn = (path: string, biomeId: number, area: RectXZ): { x: number; z: number; floor: number }[] => {
  const place = FEATURE_PLACEMENTS[path];
  if (!place) {
    reportContentError(`a <Spawn> is mounted in the "${path}" feature, which places no actors (utils/workers/featurePlacement.ts)`);
    return [];
  }
  return place(biomeId, area);
};
