import { getAllBiomes } from "../utils";
import { Region, TerrainParams } from "../../world/types";
import { assembleDomainConfig, toFlattenDescriptor } from "../../world/domains/domainConfig";
import { DomainConfig, FlattenDescriptor, SerializedRegion } from "./vertexCompute";

/** The <Domain> commit's DomainConfig — assembled by the same function as the
 *  domains' Three-free configs (world/domains/domainConfig.ts), so the server runs on the same object. */
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

  // Deduped by id, like collectDescriptors.
  const flattenById = new Map<string, FlattenDescriptor>();
  for (const biome of getAllBiomes(regions)) {
    for (const d of biome.actors ?? []) {
      if (!d.flattenGround) continue;
      flattenById.set(d.id, toFlattenDescriptor(d));
    }
  }

  return assembleDomainConfig(serializedRegions, biomeNoiseConfigs, Array.from(flattenById.values()), params);
}
