import type { ReactNode } from "react";
import { mergeActorListings, mountAttributesOf, type ActorMount } from "../../objects/actors/spec";
import { reportContentError } from "../../utils/contentError";
import type {
  BiomeNoiseConfig,
  DomainConfig,
  FlattenDescriptor,
  SerializedBiome,
  SerializedRegion,
  TerrainNoiseParams,
} from "../../utils/workers/types";
import { DEFAULT_TERRAIN_PARAMS } from "../defaults";
import type { TerrainParams } from "../types";
import { childOfKind, childrenOfKind, readContent } from "./index";
import type { ContentNode } from "./types";

/**
 * The ONE place a DomainConfig is assembled — straight off the content tree, so the client, the
 * workers and the server all run on the same description and there is nothing to keep in step. (This
 * replaced a spec list beside the JSX and a runtime JSON diff between the two configs they built.)
 * Three-free and React-free: the server imports this module (server/src/content/).
 */

/** Lowercase letters only: a name is an address word (`/<region>/<biome>`) and a shader function
 *  (`<name>_frag`, world/shaders/combineBiomeMaterials.ts). */
const NAME_RE = /^[a-z]+$/;

export interface BiomeIdentity {
  id: number;
  name: string;
  joinable?: boolean;
  blendWidth?: number;
  heightBlendWidth?: number;
}

export interface RegionIdentity {
  id: number;
  name: string;
  blendWidth?: number;
  heightBlendWidth?: number;
}

/** A biome's relief: its own `<Noise>` with any `<Dome>` and `<Detail>` layers mounted under it.
 *  Null for a biome with bespoke height code in the pipeline (the city). */
export const biomeNoiseOf = (biome: ContentNode<any>): BiomeNoiseConfig | null => {
  const noise = childOfKind<NoiseProps>(biome, "noise");
  if (!noise) return null;
  const { params, absNeg, scale, offset } = noise.props;
  const dome = childOfKind<BiomeNoiseConfig["dome"] & object>(noise, "dome");
  const detail = childrenOfKind<TerrainNoiseParams>(noise, "detail").map((d) => ({ ...d.props }));
  return {
    params,
    ...(absNeg === undefined ? {} : { absNeg }),
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
    ...(dome ? { dome: { ...dome.props } } : {}),
    ...(detail.length ? { detail } : {}),
  };
};

export interface NoiseProps extends Partial<Pick<BiomeNoiseConfig, "absNeg" | "scale" | "offset">> {
  params: TerrainNoiseParams;
}

/** Every feature mounted in a biome, by kind, with its own resolved params (its declaration's
 *  `read`, else `true`). Presence IS the fact — nothing reads a biome id or name. */
const featuresOf = (biome: ContentNode<any>): Record<string, unknown> => {
  const features: Record<string, unknown> = {};
  for (const child of biome.children) {
    if (STRUCTURAL_KINDS.has(child.kind)) continue;
    if (child.kind in features) reportContentError(`<${child.kind}> is mounted twice in biome "${biome.props.name}"`);
    features[child.kind] = child.decl.read ? child.decl.read(child) : true;
  }
  return features;
};

/** Children of a biome that are not features of it: its look, its relief, what it spawns. */
const STRUCTURAL_KINDS = new Set(["material", "noise", "actor", "skybox"]);

const serializeBiome = (biome: ContentNode<BiomeIdentity>): SerializedBiome => {
  const { id, name, joinable = false, blendWidth, heightBlendWidth } = biome.props;
  const features = featuresOf(biome);
  const water = features.water as { depth: number } | undefined;
  return {
    id,
    name,
    joinable,
    blendWidth,
    heightBlendWidth,
    water,
    // Water is impassable ground, so no inter-city freeway may run along its walls. Derived, never
    // declared: a `prohibitRoads` flag beside <Water> could only ever disagree with it.
    prohibitRoads: !!water,
    features,
  };
};

const serializeRegion = (region: ContentNode<RegionIdentity>): SerializedRegion => {
  const { id, name, blendWidth, heightBlendWidth } = region.props;
  const rivers = childOfKind<{ chance?: number }>(region, "rivers");
  return {
    id,
    name,
    biomes: childrenOfKind<BiomeIdentity>(region, "biome").map(serializeBiome),
    baseNoise: biomeNoiseOf(region)?.params,
    blendWidth,
    heightBlendWidth,
    // No <Rivers> in the region = no river under it (there is no domain-wide fallback: a river
    // exists because a region mounted one).
    riverProbability: rivers ? rivers.props.chance ?? 1 : 0,
  };
};

/** One <Actor> mounted in a biome. `feature` is the dotted path of the feature that PLACES it
 *  (a <Sewers><Rooms><Actor/>> stands one in each room), empty for a biome's own density placement;
 *  `id` is the descriptor id, which is also the entity kind on the wire. */
export interface ActorPlacement {
  id: string;
  mount: ActorMount;
  feature: string;
}

/** A feature-placed kind lists SEPARATELY from the biome's own density placement of the same kind. */
export const featureActorId = (actorId: string, feature: string): string => (feature ? `${actorId}@${feature}` : actorId);

/** Every <Actor> under a biome, at any depth, in JSX order. */
export const actorPlacementsOf = (biome: ContentNode<any>): ActorPlacement[] => {
  const out: ActorPlacement[] = [];
  const visit = (node: ContentNode<any>, feature: string): void => {
    for (const child of node.children) {
      if (child.kind === "actor") {
        const mount = child.props as unknown as ActorMount;
        out.push({ id: featureActorId(mount.actor.id, feature), mount, feature });
      } else {
        visit(child, feature ? `${feature}.${child.kind}` : child.kind);
      }
    }
  };
  visit(biome, "");
  return out;
};

/** The flatten-pad actors the biomes place, merged across the biomes that place them. */
const flattenDescriptorsOf = (regions: readonly ContentNode<any>[]): FlattenDescriptor[] => {
  const listings = regions.flatMap((region) =>
    childrenOfKind<BiomeIdentity>(region, "biome").flatMap((biome) =>
      actorPlacementsOf(biome).map(
        ({ id, mount }) =>
          ({ ...mountAttributesOf(mount), id, biomeIds: [biome.props.id] }) as Record<string, unknown> & {
            id: string;
            biomeIds: number[];
          },
      ),
    ),
  );
  return mergeActorListings(listings)
    .filter((attrs) => attrs.flattenGround)
    .map((a) => {
      const footprint = a.footprint as number;
      return {
        id: a.id,
        density: a.density as number,
        clustering: (a.clustering as number) ?? 0,
        footprint,
        priority: (a.priority as number) ?? 50,
        biomeIds: a.biomeIds,
        heightRange: a.heightRange as [number, number] | undefined,
        roadDistanceRange: a.roadDistanceRange as [number, number] | undefined,
        radius: (a.flattenRadius as number) ?? footprint * 0.45,
        skirt: (a.flattenSkirt as number) ?? footprint * 0.35,
      };
    });
};

/** Ids and names decide the world (voronoi rolls, address words, shader slots): a clash silently
 *  merges two biomes or two address themes. */
const assertDistinct = (regions: readonly SerializedRegion[]): void => {
  const problems: string[] = [];
  const seen = <T>(what: string, key: T, label: string, map: Map<T, string>) => {
    const had = map.get(key);
    if (had !== undefined && had !== label) problems.push(`${what} ${String(key)} is used by "${had}" and "${label}"`);
    map.set(key, label);
  };
  const regionIds = new Map<number, string>();
  const regionNames = new Map<string, string>();
  const biomeIds = new Map<number, string>();
  const biomeNames = new Map<string, string>();
  for (const r of regions) {
    if (!NAME_RE.test(r.name)) problems.push(`region name "${r.name}" must be lowercase letters only`);
    seen("region id", r.id, r.name, regionIds);
    seen("region name", r.name, r.name, regionNames);
    for (const b of r.biomes) {
      if (!NAME_RE.test(b.name)) problems.push(`biome name "${b.name}" must be lowercase letters only`);
      seen("biome id", b.id, b.name, biomeIds);
      seen("biome name", b.name, String(b.id), biomeNames);
    }
  }
  if (problems.length) reportContentError(`[content] ${problems.join("\n  ")}`);
};

/** A biome's id by name, from an assembled config: what a test or a tool names a biome by. */
export const biomeIdOf = (config: DomainConfig, name: string): number => {
  for (const region of config.regions) for (const biome of region.biomes) if (biome.name === name) return biome.id;
  throw new Error(`no biome named "${name}" in this domain`);
};

/** The domain's global terrain knobs: its <Terrain> props over world/defaults.ts. */
export const terrainParamsOf = (domain: ContentNode<any>): TerrainParams => {
  const terrain = childOfKind<Partial<TerrainParams>>(domain, "terrain");
  return { ...DEFAULT_TERRAIN_PARAMS, ...(terrain?.props ?? {}) };
};

/** The one <Domain> of a content tree. */
export const domainNodeOf = (tree: ReactNode): ContentNode<any> => {
  const roots = readContent(tree);
  const domains = roots.filter((n) => n.kind === "domain");
  if (domains.length !== 1) reportContentError(`[content] a world is exactly one <Domain> (found ${domains.length})`);
  return domains[0] ?? { kind: "domain", decl: { kind: "domain" }, path: "domain", props: {}, children: [] };
};

/** THE config: everything the height pipeline, the workers and the server need, off the tree. */
export const domainConfigOf = (domain: ContentNode<any>): DomainConfig => {
  const params = terrainParamsOf(domain);
  const regionNodes = childrenOfKind<RegionIdentity>(domain, "region");
  const regions = regionNodes.map(serializeRegion);
  assertDistinct(regions);

  const biomeNoiseConfigs: Record<number, BiomeNoiseConfig> = {};
  for (const region of regionNodes) {
    for (const biome of childrenOfKind<BiomeIdentity>(region, "biome")) {
      const noise = biomeNoiseOf(biome);
      if (noise) biomeNoiseConfigs[biome.props.id] = noise;
    }
  }

  return {
    flattenDescriptors: flattenDescriptorsOf(regionNodes),
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
