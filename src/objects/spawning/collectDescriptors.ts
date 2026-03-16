import { Region } from "../../world/types";
import { SpawnDescriptor } from "./types";

/**
 * Walks regions → biomes to aggregate all SpawnDescriptors.
 * Deduplicates by descriptor id (last-registered wins).
 */
export const collectDescriptors = (regions: Region[]): SpawnDescriptor[] => {
  const byId = new Map<string, SpawnDescriptor>();

  // Region → Biome level spawnables
  for (const region of regions) {
    for (const biome of region.biomes) {
      if (biome.spawnables) {
        for (const desc of biome.spawnables) {
          byId.set(desc.id, desc);
        }
      }
    }
  }

  return Array.from(byId.values());
};
