import { mergeActorListings, mountAttributesOf } from "../../objects/actors/spec";
import type {
  DomainConfig,
  FlattenDescriptor,
  SerializedBiome,
  SerializedRegion,
} from "../../utils/workers/vertexCompute";
import type { Biome, BiomeNoiseConfig, BiomeSpec, RegionSpec, RegionSpecBase, TerrainParams } from "../types";

/**
 * The one place a DomainConfig is assembled, in ONE key order, from either the
 * client's <Domain> commit (buildDomainConfig over the JSX Region[]) or a domain's
 * shared spec description (buildDomainConfigFromSpecs — what the SERVER imports).
 * Same assembler ⇒ byte-identical when JSX and specs agree, which Domain.tsx
 * checks in dev. Three-free, React-free.
 */

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

/** Lowercase letters only: a name is an address word (`/<region>/<biome>`, address.ts) and a
 *  shader function (`<name>_frag`, utils/material/_material.ts). */
const NAME_RE = /^[a-z]+$/;

/** Ids and names decide the world (voronoi rolls, address words, shader slots): a clash silently
 *  merges two biomes (the commit dedupes by id) or two address themes. */
const findSpecProblems = (regions: SerializedRegion[]): string[] => {
  const problems: string[] = [];
  const regionById = new Map<number, string>();
  const regionByName = new Map<string, number>();
  const biomeById = new Map<number, string>();
  const biomeByName = new Map<string, number>();
  for (const r of regions) {
    if (!NAME_RE.test(r.name)) problems.push(`region name "${r.name}" must be lowercase letters only`);
    if (regionById.has(r.id)) problems.push(`region id ${r.id} is used by "${regionById.get(r.id)}" and "${r.name}"`);
    if (regionByName.has(r.name)) problems.push(`two regions are named "${r.name}"`);
    regionById.set(r.id, r.name);
    regionByName.set(r.name, r.id);
    for (const b of r.biomes) {
      if (!NAME_RE.test(b.name)) problems.push(`biome name "${b.name}" must be lowercase letters only`);
      const named = biomeById.get(b.id);
      if (named !== undefined && named !== b.name) problems.push(`biome id ${b.id} is used by "${named}" and "${b.name}"`);
      const id = biomeByName.get(b.name);
      if (id !== undefined && id !== b.id) problems.push(`two biomes are named "${b.name}" (ids ${id} and ${b.id})`);
      biomeById.set(b.id, b.name);
      biomeByName.set(b.name, b.id);
    }
  }
  return problems;
};

const assertValidSpecs = (regions: SerializedRegion[]): void => {
  const problems = findSpecProblems(regions);
  if (problems.length === 0) return;
  const message = `[domain] invalid region/biome specs:\n  ${problems.join("\n  ")}`;
  if (process.env.NODE_ENV === "production") console.error(message);
  else throw new Error(message);
};

/** The ONLY place the key order is decided. */
export const assembleDomainConfig = (
  regions: SerializedRegion[],
  biomeNoiseConfigs: Record<number, BiomeNoiseConfig>,
  flattenDescriptors: FlattenDescriptor[],
  params: TerrainParams,
): DomainConfig => {
  assertValidSpecs(regions);
  return {
    flattenDescriptors,
    seed: params.seed,
    regions,
    gridSize: params.gridSize,
    regionGridSize: params.regionGridSize,
    defaultBlendWidth: params.defaultBlendWidth,
    defaultHeightBlendWidth: params.defaultHeightBlendWidth,
    roadNoiseParams: params.roadNoise,
    baseNoiseParams: params.baseNoise,
    river: params.river,
    biomeNoiseConfigs,
    cityConfig: params.cityConfig,
  };
};

/** Serializers keep one KEY ORDER per level (the dev drift check compares JSON). */
export const serializeBiome = (b: BiomeSpec | Biome): SerializedBiome => ({
  id: b.id,
  name: b.name,
  joinable: b.joinable,
  blendWidth: b.blendWidth,
  heightBlendWidth: b.heightBlendWidth,
  water: b.water,
  // Booleans on both paths: the JSX side writes `false` for an unset flag, a spec omits it, and
  // the dev drift check compared `false` against a missing key for every biome.
  prohibitRoads: !!b.prohibitRoads,
  prohibitRivers: !!b.prohibitRivers,
});

export const serializeRegion = (r: RegionSpecBase, biomes: SerializedBiome[]): SerializedRegion => ({
  id: r.id,
  name: r.name,
  biomes,
  baseNoise: r.baseNoise,
  blendWidth: r.blendWidth,
  heightBlendWidth: r.heightBlendWidth,
  riverProbability: r.riverProbability,
});

/** The flatten-pad actors the biome specs list, in registration order (region → biome → mount), each
 *  spawning in the biomes that list it — merged exactly like the commit (buildDomainConfig.ts). */
const flattenDescriptorsOf = (regions: RegionSpec[]): FlattenDescriptor[] => {
  const listings = regions.flatMap((r) =>
    r.biomes.flatMap((b) =>
      (b.actors ?? []).map((mount): Record<string, unknown> & { id: string; biomeIds: number[] } => ({
        ...mountAttributesOf(mount),
        id: mount.actor.id,
        biomeIds: [b.id],
      })),
    ),
  );
  return mergeActorListings(listings)
    .filter((attrs) => attrs.flattenGround)
    .map((attrs) => toFlattenDescriptor(attrs as unknown as FlattenPlacement));
};

/** A domain's shared config from its region specs alone (the flatten pads come from the biomes' `actors`). */
export const buildDomainConfigFromSpecs = (input: { params: TerrainParams; regions: RegionSpec[] }): DomainConfig => {
  const regions: SerializedRegion[] = input.regions.map((r) => serializeRegion(r, r.biomes.map(serializeBiome)));
  const noise: Record<number, BiomeNoiseConfig> = {};
  for (const r of input.regions) for (const b of r.biomes) if (b.noise) noise[b.id] = b.noise;
  return assembleDomainConfig(regions, noise, flattenDescriptorsOf(input.regions), input.params);
};
