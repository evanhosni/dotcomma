import type { DomainConfig, FlattenDescriptor } from "../../../../src/utils/workers/vertexCompute";
import { CITY_BIOME_ID, DUST_BIOME_ID, GRASS_BIOME_ID } from "../../../../src/world/constants";
import { DEFAULT_TERRAIN_PARAMS } from "../../../../src/world/defaults";

/**
 * HAND-ASSEMBLED transcription of what `buildDomainConfig` produces from the
 * glitch-city JSX (domain.tsx → each region.tsx → each biome.tsx + the
 * building/skyscraper descriptors). KEEP IN SYNC BY HAND: region/biome
 * order IS the voronoi order (a mismatch lands every biome somewhere else),
 * flatten descriptors keep JSX registration order, radius/skirt are
 * buildDomainConfig's defaults (footprint × 0.45 / × 0.35). GrassRegion exists
 * in code but is NOT mounted by the domain.
 */

const flatten = (
  id: string,
  footprint: number,
  density: number,
  priority: number,
  biomeIds: number[],
  roadDistanceRange: [number, number],
): FlattenDescriptor => ({
  id,
  density,
  clustering: 0,
  footprint,
  priority,
  biomeIds,
  heightRange: undefined,
  roadDistanceRange,
  radius: footprint * 0.45,
  skirt: footprint * 0.35,
});

const p = DEFAULT_TERRAIN_PARAMS;

export const GLITCH_CITY_DOMAIN_CONFIG: DomainConfig = {
  seed: "123",
  regions: [
    {
      id: 3,
      name: "city",
      biomes: [
        { id: CITY_BIOME_ID, name: "city", joinable: true, blendable: false, blendWidth: 3 },
        { id: GRASS_BIOME_ID, name: "grass", joinable: true, blendable: true, blendWidth: undefined },
      ],
    },
    {
      id: 2,
      name: "desert",
      biomes: [{ id: DUST_BIOME_ID, name: "dust", joinable: true, blendable: true, blendWidth: undefined }],
    },
  ],
  gridSize: p.gridSize,
  regionGridSize: p.regionGridSize,
  boundaryWidth: p.boundaryWidth,
  riverWidth: p.riverWidth,
  defaultBlendWidth: p.defaultBlendWidth,
  roadNoiseParams: p.roadNoise,
  baseNoiseParams: p.baseNoise,
  biomeNoiseConfigs: {
    [GRASS_BIOME_ID]: {
      params: { type: "perlin", octaves: 3, persistence: 1, lacunarity: 1, exponentiation: 1, height: 100, scale: 100 },
    },
    [DUST_BIOME_ID]: {
      params: { type: "perlin", octaves: 3, persistence: 1, lacunarity: 1, exponentiation: 1, height: 150, scale: 200 },
      absNeg: true,
      offset: 50,
    },
  },
  cityConfig: p.cityConfig,
  flattenDescriptors: [
    flatten("building", 30, 3800, 55, [CITY_BIOME_ID], [23, 99999]),
    flatten("skyscraper", 36, 240, 45, [CITY_BIOME_ID], [28, 99999]),
    flatten("grass-building", 30, 25, 55, [GRASS_BIOME_ID], [23, 99999]),
  ],
};
