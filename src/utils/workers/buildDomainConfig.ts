import { getAllBiomes } from "../utils";
import { TerrainParams } from "../../world/types";
import { Region } from "../../world/types";
import { FlattenDescriptor, SerializedRegion, DomainConfig } from "./vertexCompute";

/**
 * Builds a serializable DomainConfig from regions + global terrain params.
 * This config is sent to terrain/spawn/grass workers to initialize the
 * inlined vertex computation pipeline.
 *
 * Global params come from the world-level <Terrain> component; per-biome
 * noise comes from each biome-level <Terrain noise={...}> registration.
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
      flattenById.set(d.id, {
        id: d.id,
        density: d.density,
        clustering: d.clustering,
        footprint: d.footprint,
        priority: d.priority ?? 50,
        biomeIds: d.biomeIds,
        heightRange: d.heightRange,
        roadDistanceRange: d.roadDistanceRange,
        radius: d.flattenRadius ?? d.footprint * 0.45,
        skirt: d.flattenSkirt ?? d.footprint * 0.35,
      });
    }
  }
  const flattenDescriptors = Array.from(flattenById.values());

  return {
    flattenDescriptors,
    seed: params.seed,
    regions: serializedRegions,
    gridSize: params.gridSize,
    regionGridSize: params.regionGridSize,
    boundaryWidth: params.boundaryWidth,
    riverWidth: params.riverWidth,
    defaultBlendWidth: params.defaultBlendWidth,
    roadNoiseParams: params.roadNoise,
    baseNoiseParams: params.baseNoise,
    biomeNoiseConfigs,
    cityConfig: params.cityConfig,
  };
}
