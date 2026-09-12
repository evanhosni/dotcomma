import { getAllBiomes } from "../utils";
import { Region, TerrainParams } from "../../world/types";
import { assembleDomainConfig, toFlattenDescriptor } from "../../world/domains/domainConfig";
import { DomainConfig, FlattenDescriptor, SerializedRegion } from "./vertexCompute";

/**
 * Builds a serializable DomainConfig from the JSX-registered regions + global
 * terrain params — what <Domain> commits and sends to the terrain/spawn/
 * grass/dressing workers to initialize the inlined vertex pipeline.
 *
 * Global params come from the world-level <Terrain> component; per-biome
 * noise comes from each biome-level <Terrain noise={...}> registration. The
 * assembly itself is shared with the domains' Three-free configs
 * (world/domains/domainConfig.ts) so the server runs on the same object.
 */
export function buildDomainConfig(regions: Region[], params: TerrainParams): DomainConfig {
  const serializedRegions: SerializedRegion[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    biomes: r.biomes.map((b) => ({
      id: b.id,
      name: b.name,
      joinable: b.joinable,
      blendable: b.blendable,
      blendWidth: b.blendWidth,
    })),
  }));

  const biomeNoiseConfigs: DomainConfig["biomeNoiseConfigs"] = {};
  for (const biome of getAllBiomes(regions)) {
    if (biome.noise) biomeNoiseConfigs[biome.id] = biome.noise;
  }

  // Actors with flattenGround get their placement rules serialized into the
  // config so the height function can flatten a pad under every instance
  // (deduped by id, like collectDescriptors).
  const flattenById = new Map<string, FlattenDescriptor>();
  for (const biome of getAllBiomes(regions)) {
    for (const d of biome.actors ?? []) {
      if (!d.flattenGround) continue;
      flattenById.set(d.id, toFlattenDescriptor(d));
    }
  }

  return assembleDomainConfig(serializedRegions, biomeNoiseConfigs, Array.from(flattenById.values()), params);
}
