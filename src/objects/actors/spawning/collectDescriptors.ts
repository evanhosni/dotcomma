import { Region } from "../../../world/types";
import { ActorDescriptor } from "./types";

/**
 * Walks regions → biomes to aggregate all ActorDescriptors.
 * Deduplicates by descriptor id (last-registered wins).
 */
export const collectDescriptors = (regions: Region[]): ActorDescriptor[] => {
  const byId = new Map<string, ActorDescriptor>();

  for (const region of regions) {
    for (const biome of region.biomes) {
      if (biome.actors) {
        for (const desc of biome.actors) {
          byId.set(desc.id, desc);
        }
      }
    }
  }

  return Array.from(byId.values());
};
