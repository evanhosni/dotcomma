import type { DomainConfig, FlattenDescriptor } from "../../../../src/utils/workers/vertexCompute";
import { CITY_BIOME_ID, DUST_BIOME_ID, GRASS_BIOME_ID } from "../../../../src/world/constants";
import { DEFAULT_TERRAIN_PARAMS } from "../../../../src/world/defaults";

/**
 * The glitch-city DomainConfig, HAND-ASSEMBLED for the server.
 *
 * On the client this object is produced by `buildDomainConfig(regions,
 * params)` from the JSX registrations at <Domain> commit time. The server has
 * no JSX, so until a shared Three-free per-domain config module exists this
 * file transcribes:
 *
 *   src/world/domains/glitch-city/domain.tsx            <Terrain seed="123"/> (= defaults)
 *   .../regions/city/region.tsx                           region "city" id 3: CityBiome, CityGrassBiome
 *   .../regions/desert/region.tsx                         region "desert" id 2: DustBiome
 *   .../regions/city/biomes/city/biome.tsx                city id 1, joinable, blendable=false, blendWidth 3
 *                                                           BuildingActor + SkyscraperActor (biomeIds [1])
 *   .../regions/city/biomes/grass/biome.tsx               grass id 3, joinable, blendable, perlin 3/1/1/1 h100 s100
 *                                                           BuildingActor id="grass-building" density 25 (biomeIds [3])
 *   .../regions/desert/biomes/dust/biome.tsx              dust id 2, joinable, blendable, perlin 3/1/1/1 h150 s200,
 *                                                           absNeg, offset 50
 *   src/objects/actors/building/actor.tsx + skyscraper.tsx flatten descriptors (footprint 30 / 36, etc.)
 *
 * REGION AND BIOME ORDER IS THE VORONOI ORDER — it must match the JSX exactly
 * or every biome lands somewhere else. Flatten descriptors keep the JSX
 * registration order too (building, skyscraper, grass-building) and their
 * radius/skirt use buildDomainConfig's defaults (footprint × 0.45 / × 0.35).
 * The GrassRegion exists in code but is NOT mounted by the domain.
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
