/**
 * THE flags helper: which biomes carry what, from the LIVE config (empty before the pipeline is
 * initialized). Every system that keys on a biome's nature reads it here — water-based, cave, snow,
 * sewer, rock, road-bearing — never a biome id or name (CLAUDE.md "Adding Content"). The one id the
 * pipeline still branches on is the bespoke city's (CITY_BIOME_ID), and this is where that branch is
 * turned into a flag ("road-bearing") for everything downstream. Three-free.
 */

import { CITY_BIOME_ID } from "../../world/constants";
import { domainConfig } from "./computeConfig";
import type { DomainConfig, SerializedBiome } from "./types";

/** A spec flag `true | {…overrides}` resolved against its system's defaults; null where unset. */
export const resolveFlag = <T extends object>(flag: boolean | Partial<T> | undefined, defaults: T): T | null =>
  flag === undefined || flag === false ? null : { ...defaults, ...(flag === true ? {} : flag) };

/** ROCK is a domed biome: rivers build through its relief (waterfalls, pools, springs), only its banks
 *  end a riverbed by slope, and caves open in it. */
export const isRockBiome = (noise: { dome?: unknown } | undefined): boolean => !!noise?.dome;

interface BiomeFlags {
  byId: Map<number, SerializedBiome>;
  water: number[];
  caves: number[];
  snow: number[];
  sewers: number[];
  rocks: number[];
  roadBearing: number[];
}

const EMPTY: BiomeFlags = { byId: new Map(), water: [], caves: [], snow: [], sewers: [], rocks: [], roadBearing: [] };
let flagsOf: DomainConfig | null = null;
let flags: BiomeFlags = EMPTY;

const computeFlags = (config: DomainConfig): BiomeFlags => {
  const f: BiomeFlags = { byId: new Map(), water: [], caves: [], snow: [], sewers: [], rocks: [], roadBearing: [] };
  for (const r of config.regions) {
    for (const b of r.biomes) {
      if (f.byId.has(b.id)) continue;
      f.byId.set(b.id, b);
      if (b.water) f.water.push(b.id);
      if (b.caves) f.caves.push(b.id);
      if (b.snow) f.snow.push(b.id);
      if (b.sewers) f.sewers.push(b.id);
      if (b.rocks) f.rocks.push(b.id);
      // The bespoke city is the one biome with a street lattice and arterials (the pipeline's one id branch).
      if (b.id === CITY_BIOME_ID && config.cityConfig) f.roadBearing.push(b.id);
    }
  }
  return f;
};

const current = (): BiomeFlags => {
  const config = domainConfig;
  if (!config) return EMPTY;
  if (config !== flagsOf) {
    flagsOf = config;
    flags = computeFlags(config);
  }
  return flags;
};

export const biomeById = (id: number): SerializedBiome | undefined => current().byId.get(id);
/** Biomes with `water: { depth }` (lakes, seas, basins). */
export const waterBiomeIds = (): number[] => current().water;
/** Biomes with `caves`. */
export const caveBiomeIds = (): number[] => current().caves;
/** Biomes with `snow`. */
export const snowBiomeIds = (): number[] => current().snow;
/** Biomes with `sewers`. */
export const sewerBiomeIds = (): number[] => current().sewers;
/** Biomes with a `rocks` field. */
export const rockFieldBiomeIds = (): number[] => current().rocks;
/** Biomes that bear roads of their own (streets, arterials, a belt): today the bespoke city. */
export const roadBearingBiomeIds = (): number[] => current().roadBearing;

export const caveParamsOf = (biomeId: number) => biomeById(biomeId)?.caves ?? null;
export const snowParamsOf = (biomeId: number) => biomeById(biomeId)?.snow ?? null;
export const sewerParamsOf = (biomeId: number) => biomeById(biomeId)?.sewers ?? null;
export const rockParamsOf = (biomeId: number) => biomeById(biomeId)?.rocks ?? null;
export const riverBankReliefOf = (biomeId: number) => biomeById(biomeId)?.riverBankRelief ?? null;

/** Whether a region is an OCEAN: every one of its biomes is water-based. */
export const isWaterRegion = (region: { biomes: readonly SerializedBiome[] }): boolean =>
  region.biomes.length > 0 && region.biomes.every((b) => !!b.water);
