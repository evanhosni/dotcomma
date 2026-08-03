import { getAllBiomes } from "../utils/utils";
import { WorldTerrainParams } from "../world/registry";
import { Region } from "../world/types";
import { SerializedRegion, WorldConfig } from "./vertexCompute";

/**
 * Builds a serializable WorldConfig from regions + global terrain params.
 * This config is sent to terrain/spawn/grass workers to initialize the
 * inlined vertex computation pipeline.
 *
 * Global params come from the world-level <Terrain> component; per-biome
 * noise comes from each biome-level <Terrain noise={...}> registration.
 */
export function buildWorldConfig(regions: Region[], params: WorldTerrainParams): WorldConfig {
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

  const biomeNoiseConfigs: WorldConfig["biomeNoiseConfigs"] = {};
  for (const biome of getAllBiomes(regions)) {
    if (biome.noise) biomeNoiseConfigs[biome.id] = biome.noise;
  }

  return {
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
