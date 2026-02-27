import { Dimension } from "../../world/types";
import { SpawnDescriptor } from "./types";

/**
 * Walks dimension → regions → biomes to aggregate all SpawnDescriptors.
 * Deduplicates by descriptor id (last-registered wins).
 */
export const collectDescriptors = (dimension: Dimension): SpawnDescriptor[] => {
  const byId = new Map<string, SpawnDescriptor>();

  // Dimension-level spawnables
  if (dimension.spawnables) {
    for (const desc of dimension.spawnables) {
      byId.set(desc.id, desc);
    }
  }

  // Region → Biome level spawnables
  for (const region of dimension.regions) {
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
