import { collectDescriptors } from "../../objects/actors/spawning/collectDescriptors";
import { getAllBiomes } from "../../utils/utils";
import { Region, TerrainParams } from "../types";
import { assembleDomainConfig, serializeBiome, serializeRegion, toFlattenDescriptor } from "./domainConfig";
import { DomainConfig, FlattenDescriptor, SerializedRegion } from "../../utils/workers/vertexCompute";

/** The <Domain> commit's DomainConfig — assembled by the same function as the
 *  domains' Three-free configs (world/domains/domainConfig.ts), so the server runs on the same object. */
export function buildDomainConfig(regions: Region[], params: TerrainParams): DomainConfig {
  const serialized: SerializedRegion[] = regions.map((r) => serializeRegion(r, r.biomes.map(serializeBiome)));

  const biomeNoiseConfigs: DomainConfig["biomeNoiseConfigs"] = {};
  for (const biome of getAllBiomes(regions)) {
    if (biome.noise) biomeNoiseConfigs[biome.id] = biome.noise;
  }

  const flatten: FlattenDescriptor[] = collectDescriptors(regions)
    .filter((d) => d.flattenGround)
    .map((d) => toFlattenDescriptor(d));

  return assembleDomainConfig(serialized, biomeNoiseConfigs, flatten, params);
}
