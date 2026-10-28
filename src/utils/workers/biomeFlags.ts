/**
 * WHAT A BIOME CARRIES, from the LIVE config (empty before the pipeline is initialized). A biome's
 * features are whatever components are mounted inside its <Biome> (world/content/), keyed by their
 * declaration's kind, so this module needs to know NOTHING about any of them: a system asks for its
 * own kind and gets its own resolved params. Nothing anywhere keys on a biome's id or name — the one
 * exception is the bespoke city's height branch (CITY_BIOME_ID), turned into the "road-bearing"
 * question here. Three-free.
 *
 * Each system exports its own typed accessors next to its component (`snowBiomeIds()` lives with
 * <Snow/>), so deleting a system deletes every mention of it.
 */

import { CITY_BIOME_ID } from "../../world/constants";
import { domainConfig } from "./computeConfig";
import type { DomainConfig, SerializedBiome } from "./types";

/** ROCK is a domed biome: rivers build through its relief (waterfalls, pools, springs), only its banks
 *  end a riverbed by slope, and caves open in it. */
export const isRockBiome = (noise: { dome?: unknown } | undefined): boolean => !!noise?.dome;

interface BiomeIndex {
  byId: Map<number, SerializedBiome>;
  /** Biome ids per feature kind, in config order. */
  byFeature: Map<string, number[]>;
  roadBearing: number[];
}

const EMPTY: BiomeIndex = { byId: new Map(), byFeature: new Map(), roadBearing: [] };
let indexedFrom: DomainConfig | null = null;
let index: BiomeIndex = EMPTY;

const buildIndex = (config: DomainConfig): BiomeIndex => {
  const built: BiomeIndex = { byId: new Map(), byFeature: new Map(), roadBearing: [] };
  for (const region of config.regions) {
    for (const biome of region.biomes) {
      if (built.byId.has(biome.id)) continue;
      built.byId.set(biome.id, biome);
      for (const kind of Object.keys(biome.features ?? {})) {
        const ids = built.byFeature.get(kind);
        if (ids) ids.push(biome.id);
        else built.byFeature.set(kind, [biome.id]);
      }
      // The bespoke city is the one biome with a street lattice and arterials (the pipeline's one id branch).
      if (biome.id === CITY_BIOME_ID && config.cityConfig) built.roadBearing.push(biome.id);
    }
  }
  return built;
};

const current = (): BiomeIndex => {
  const config = domainConfig;
  if (!config) return EMPTY;
  if (config !== indexedFrom) {
    indexedFrom = config;
    index = buildIndex(config);
  }
  return index;
};

const NONE: number[] = [];

export const biomeById = (id: number): SerializedBiome | undefined => current().byId.get(id);

/** The biomes that mounted a feature of this kind. */
export const biomeIdsWith = (kind: string): number[] => current().byFeature.get(kind) ?? NONE;

/** One biome's resolved params for a feature kind, or null where it did not mount one. */
export const biomeFeature = <T>(biomeId: number, kind: string): T | null =>
  (biomeById(biomeId)?.features?.[kind] as T | undefined) ?? null;

/** A biome's relief as the config holds it (null for a biome with bespoke height code). */
export const biomeNoiseConfigOf = (biomeId: number) => domainConfig?.biomeNoiseConfigs[biomeId];

/** Every biome that mounted a feature of this kind, with its own resolved params — what a
 *  feature's ONE driver reads to draw every mount of it. */
export const featureMounts = <T>(kind: string): { biomeId: number; params: T }[] =>
  biomeIdsWith(kind).map((biomeId) => ({ biomeId, params: biomeFeature<T>(biomeId, kind) as T }));

/** Biomes that bear roads of their own (streets, arterials, a belt): today the bespoke city. */
export const roadBearingBiomeIds = (): number[] => current().roadBearing;

/** Whether a region is an OCEAN: every one of its biomes is water-based. */
export const isWaterRegion = (region: { biomes: readonly SerializedBiome[] }): boolean =>
  region.biomes.length > 0 && region.biomes.every((b) => !!b.water);
