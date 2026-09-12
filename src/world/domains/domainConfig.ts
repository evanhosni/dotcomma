import type { DomainConfig, FlattenDescriptor, SerializedRegion } from "../../utils/workers/vertexCompute";
import type { BiomeNoiseConfig, BiomeSpec, TerrainParams } from "../types";

/**
 * DOMAIN CONFIG ASSEMBLY — the one place a `DomainConfig` (what every worker
 * AND the server's height pipeline run on) is put together, in ONE key order,
 * from two kinds of input:
 *
 *   - the CLIENT's <Domain> commit: `buildDomainConfig(regions, params)`
 *     (utils/workers/buildDomainConfig.ts) over the JSX-registered Region[];
 *   - a domain's SHARED, Three-free description: `buildDomainConfigFromSpecs`
 *     over region/biome SPECS (`<biome>/spec.ts`) and flatten placements —
 *     what `world/domains/<domain>/config.ts` exports and the SERVER imports.
 *
 * Both go through `assembleDomainConfig`, so the two results are byte-identical
 * when the JSX and the specs agree — which the <Domain> commit checks in dev
 * (components/Domain.tsx) and complains about loudly when they don't.
 * Three-free, React-free: the server bundles this.
 */

/** A region as data: id, name, and its biomes in VORONOI (= JSX) order. */
export interface RegionSpec {
  id: number;
  name: string;
  biomes: BiomeSpec[];
}

/** The placement rules of a flatten-pad actor (buildings): the descriptor's
 *  spawn attributes plus the mount's overrides (biomeIds, density). */
export interface FlattenPlacement {
  id: string;
  footprint: number;
  density: number;
  clustering?: number;
  priority?: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  roadDistanceRange?: [number, number];
  flattenRadius?: number;
  flattenSkirt?: number;
}

/** The flatten-pad engine's descriptor for one placement (defaults: pad
 *  radius footprint × 0.45, skirt footprint × 0.35). */
export const toFlattenDescriptor = (d: FlattenPlacement): FlattenDescriptor => ({
  id: d.id,
  density: d.density,
  clustering: d.clustering ?? 0,
  footprint: d.footprint,
  priority: d.priority ?? 50,
  biomeIds: d.biomeIds,
  heightRange: d.heightRange,
  roadDistanceRange: d.roadDistanceRange,
  radius: d.flattenRadius ?? d.footprint * 0.45,
  skirt: d.flattenSkirt ?? d.footprint * 0.35,
});

/** Assemble the final object — the ONLY place its key order is decided. */
export const assembleDomainConfig = (
  regions: SerializedRegion[],
  biomeNoiseConfigs: Record<number, BiomeNoiseConfig>,
  flattenDescriptors: FlattenDescriptor[],
  params: TerrainParams,
): DomainConfig => ({
  flattenDescriptors,
  seed: params.seed,
  regions,
  gridSize: params.gridSize,
  regionGridSize: params.regionGridSize,
  boundaryWidth: params.boundaryWidth,
  riverWidth: params.riverWidth,
  defaultBlendWidth: params.defaultBlendWidth,
  roadNoiseParams: params.roadNoise,
  baseNoiseParams: params.baseNoise,
  biomeNoiseConfigs,
  cityConfig: params.cityConfig,
});

export const serializeBiomeSpec = (b: BiomeSpec): SerializedRegion["biomes"][number] => ({
  id: b.id,
  name: b.name,
  joinable: b.joinable,
  blendable: b.blendable,
  blendWidth: b.blendWidth,
});

/** A domain's config from its shared specs (see the header). `flatten` lists
 *  the flatten-pad actors in JSX registration order. */
export const buildDomainConfigFromSpecs = (input: {
  params: TerrainParams;
  regions: RegionSpec[];
  flatten: FlattenPlacement[];
}): DomainConfig => {
  const regions: SerializedRegion[] = input.regions.map((r) => ({
    id: r.id,
    name: r.name,
    biomes: r.biomes.map(serializeBiomeSpec),
  }));
  const noise: Record<number, BiomeNoiseConfig> = {};
  for (const r of input.regions) for (const b of r.biomes) if (b.noise) noise[b.id] = b.noise;
  return assembleDomainConfig(regions, noise, input.flatten.map(toFlattenDescriptor), input.params);
};
