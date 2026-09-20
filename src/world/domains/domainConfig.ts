import type { DomainConfig, FlattenDescriptor, SerializedRegion } from "../../utils/workers/vertexCompute";
import type { BiomeNoiseConfig, BiomeSpec, TerrainParams } from "../types";

/**
 * The one place a DomainConfig is assembled, in ONE key order, from either the
 * client's <Domain> commit (buildDomainConfig over the JSX Region[]) or a domain's
 * shared spec description (buildDomainConfigFromSpecs — what the SERVER imports).
 * Same assembler ⇒ byte-identical when JSX and specs agree, which Domain.tsx
 * checks in dev. Three-free, React-free.
 */

export interface RegionSpec {
  id: number;
  name: string;
  /** VORONOI (= JSX) order. */
  biomes: BiomeSpec[];
}

/** A flatten-pad actor's spawn attributes plus its mount overrides. */
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

/** The ONLY place the key order is decided. */
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

/** `flatten` lists the flatten-pad actors in JSX registration order. */
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
