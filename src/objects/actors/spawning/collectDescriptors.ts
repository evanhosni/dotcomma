import { Region } from "../../../world/types";
import { AnyActorDescriptor } from "./types";

/**
 * Walks regions → biomes to aggregate all ActorDescriptors.
 * Deduplicates by descriptor id (last-registered wins).
 */
export const collectDescriptors = (regions: Region[]): AnyActorDescriptor[] => {
  const byId = new Map<string, AnyActorDescriptor>();

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
