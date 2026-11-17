import type { ReactNode } from "react";
import { mergeActorListings, mountAttributesOf } from "../../../objects/actors/spec";
import type { ActorMount } from "../../../objects/actors/spec";
import { reportContentError } from "../../../utils/utils";
import type { BiomeNoiseConfig, DomainConfig, FlattenDescriptor, SerializedBiome, SerializedRegion, TerrainNoiseParams } from "../../../generation/types";
import { POND_KIND, RIVERS, WATER } from "../../../generation/water/params";
import type { RiversParams } from "../../../generation/water/rivers/params";
import type { WaterBase, WaterBody, WaterParams } from "../../../generation/water/types";
import { isWaterBody, waterBodyNodesOf, waterBodyOf, waterPartsOf } from "../../components/water/utils";
import { waterBodyParamsOf } from "../../components/water/registry";
import type { MaterialProps } from "../../components/Material";
import { DEFAULT_TERRAIN_PARAMS } from "../../defaults";
import type { TerrainParams } from "../../types";
import { childOfKind, childrenOfKind, readContent } from "..";
import type { ContentNode } from "../types";
import type { NoiseProps, BiomeIdentity, RegionIdentity, ActorPlacement } from "./types";

/**
 * The ONE place a DomainConfig is assembled — straight off the content tree, so the client, the
 * workers and the server all run on the same description and there is nothing to keep in step. (This
 * replaced a spec list beside the JSX and a runtime JSON diff between the two configs they built.)
 * Three-free and React-free: the server imports this module (server/src/content/).
 */

/** Lowercase letters only: a name is an address word (`/<region>/<biome>`) and a shader function
 *  (`<name>_frag`, world/shaders/biome-materials/index.ts). */
const NAME_RE = /^[a-z]+$/;

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

/** Every feature mounted in a biome, by kind, with its own resolved params (its declaration's
 *  `read`, a body of water's with the <Water> base's defaults for its kind; else `true`). Presence IS the
 *  fact — nothing reads a biome id or name. */
const featuresOf = (biome: ContentNode<any>, water: WaterBase | null): Record<string, unknown> => {
  const features: Record<string, unknown> = {};
  for (const child of biome.children) {
    if (STRUCTURAL_KINDS.has(child.kind)) continue;
    if (child.kind in features) reportContentError(`<${child.kind}> is mounted twice in biome "${biome.props.name}"`);
    features[child.kind] = isWaterBody(child) ? waterBodyParamsOf(child, water) : child.decl.read ? child.decl.read(child) : true;
  }
  return features;
};

/** Children of a biome that are not features of it: its look, its relief, what it spawns, and the
 *  bodies of water a biome may mount several of (<Pond>: they list in its `waterBodies`). */
const STRUCTURAL_KINDS = new Set(["material", "noise", "actor", "skybox", POND_KIND]);

const serializeBiome = (biome: ContentNode<BiomeIdentity>, region: ContentNode<any>, slots: ReadonlyMap<ContentNode<any>, number>, water: WaterBase | null): SerializedBiome => {
  const { id, name, joinable = false, weight, blendWidth, heightBlendWidth, pondMinRadius, additionalHeight, additionalHeightBlend } = biome.props;
  if (weight !== undefined && !(weight > 0)) reportContentError(`biome "${name}": a roll weight must be positive (got ${weight})`);
  const bedYieldSlope = childOfKind<MaterialProps>(biome, "material")?.props.riverbed?.yieldSlope;
  return {
    id,
    name,
    joinable,
    ...(weight === undefined ? {} : { weight }),
    blendWidth,
    heightBlendWidth,
    ...(pondMinRadius === undefined ? {} : { pondMinRadius }),
    ...(additionalHeight === undefined ? {} : { additionalHeight }),
    ...(additionalHeightBlend === undefined ? {} : { additionalHeightBlend }),
    ...(bedYieldSlope ? { bedYieldSlope } : {}),
    features: featuresOf(biome, water),
    waterBodies: waterBodyNodesOf(biome, region).map((n) => slots.get(n)!),
  };
};

const serializeRegion = (region: ContentNode<RegionIdentity>, slots: ReadonlyMap<ContentNode<any>, number>, water: WaterBase | null): SerializedRegion => {
  const { id, name, blendWidth, heightBlendWidth, pondMinRadius, additionalHeight, additionalHeightBlend } = region.props;
  const rivers = childOfKind(region, RIVERS);
  return {
    id,
    name,
    biomes: childrenOfKind<BiomeIdentity>(region, "biome").map((biome) => serializeBiome(biome, region, slots, water)),
    baseNoise: biomeNoiseOf(region)?.params,
    blendWidth,
    heightBlendWidth,
    ...(pondMinRadius === undefined ? {} : { pondMinRadius }),
    ...(additionalHeight === undefined ? {} : { additionalHeight }),
    ...(additionalHeightBlend === undefined ? {} : { additionalHeightBlend }),
    // No <Rivers> in the region = no river under it (there is no domain-wide fallback: a river
    // exists because a region mounted one).
    riverChance: rivers ? ((rivers.decl.read!(rivers) as RiversParams).chance ?? 1) : 0,
  };
};

/** Every body of water the regions mount, in tree order (each region's, then each of its biomes'), as
 *  the one body base lists it (world/components/water/Water.tsx waterBodyOf), and each mount's slot. A vertex names
 *  its water by an index into this list (VertexResult.waterBody). */
const waterBodiesOf = (regions: readonly ContentNode<any>[], water: WaterBase | null): { bodies: WaterBody[]; slots: Map<ContentNode<any>, number> } => {
  const bodies: WaterBody[] = [];
  const slots = new Map<ContentNode<any>, number>();
  const add = (node: ContentNode<any>, at: Pick<WaterBody, "regionId" | "biomeId">): void => {
    slots.set(node, bodies.length);
    bodies.push({ ...waterBodyOf(node, water), ...at });
  };
  for (const region of regions) {
    for (const body of region.children.filter(isWaterBody)) add(body, { regionId: region.props.id });
    for (const biome of childrenOfKind<BiomeIdentity>(region, "biome")) {
      for (const body of biome.children.filter(isWaterBody)) add(body, { biomeId: biome.props.id });
    }
  }
  return { bodies, slots };
};

/** The domain's <Water> base: its own params and its parts (null: it mounts none). */
const waterBaseOf = (domain: ContentNode<any>): WaterBase | null => {
  const water = childOfKind(domain, WATER);
  return water ? { params: water.decl.read!(water) as WaterParams, parts: waterPartsOf(water) } : null;
};

/** A feature-placed kind lists SEPARATELY from the biome's own density placement of the same kind. */
export const featureActorId = (actorId: string, feature: string): string => (feature ? `${actorId}@${feature}` : actorId);

/** Every <Actor> under a biome, at any depth, in JSX order — and inside its region's bodies of water it
 *  does not override (the region fold: world/components/water/Water.tsx waterBodyNodesOf). */
export const actorPlacementsOf = (biome: ContentNode<any>, region: ContentNode<any> | null): ActorPlacement[] => {
  const out: ActorPlacement[] = [];
  const visit = (node: ContentNode<any>, feature: string): void => {
    for (const child of node.children) {
      if (child.kind === "actor") {
        const mount = child.props as unknown as ActorMount;
        out.push({ id: featureActorId(mount.actor.id, feature), mount, feature });
      } else {
        const segment = child.decl.placesAs?.(child) ?? child.kind;
        visit(child, feature ? `${feature}.${segment}` : segment);
      }
    }
  };
  visit(biome, "");
  for (const body of waterBodyNodesOf(biome, region)) if (!biome.children.includes(body)) visit({ ...biome, children: [body] }, "");
  return out;
};

/** The flatten-pad actors the biomes place, merged across the biomes that place them. */
const flattenDescriptorsOf = (regions: readonly ContentNode<any>[]): FlattenDescriptor[] => {
  const listings = regions.flatMap((region) =>
    childrenOfKind<BiomeIdentity>(region, "biome").flatMap((biome) =>
      actorPlacementsOf(biome, region).map(
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
  const water = waterBaseOf(domain);
  const { bodies: waterBodies, slots } = waterBodiesOf(regionNodes, water);
  const regions = regionNodes.map((region) => serializeRegion(region, slots, water));
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
    defaultPondMinRadius: params.defaultPondMinRadius,
    defaultAdditionalHeight: params.defaultAdditionalHeight,
    defaultAdditionalHeightBlend: params.defaultAdditionalHeightBlend,
    roadNoiseParams: params.roadNoise,
    baseNoiseParams: params.baseNoise,
    river: params.river,
    biomeNoiseConfigs,
    water,
    waterBodies,
    cityConfig: params.cityConfig,
  };
};
