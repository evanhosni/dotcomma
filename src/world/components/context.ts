import { createContext, useContext, type Context } from "react";
import { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import type { TerrainNoiseParams } from "../../utils/workers/vertexCompute";
import { BiomeNoiseConfig, BiomeSpec, BiomeWaterConfig, MaterialData, RegionSpec, RiverbedMaterial, TerrainParams } from "../types";

// Registration store behind the <Domain> tree. Map insertion order = JSX order,
// which voronoi assignment depends on (regions AND biomes).

export interface RegionRecord {
  id: number;
  name: string;
  baseNoise?: TerrainNoiseParams;
  blendWidth?: number;
  heightBlendWidth?: number;
  riverProbability?: number;
}

export interface BiomeRecord {
  id: number;
  name: string;
  joinable: boolean;
  blendWidth?: number;
  heightBlendWidth?: number;
  water?: BiomeWaterConfig;
  prohibitRoads?: boolean;
  prohibitRivers?: boolean;
  noise?: BiomeNoiseConfig;
}

export interface SkyboxSettings {
  topColor: string;
  horizonColor: string;
  bottomColor: string;
  radius: number;
}

export interface SkyboxRecord extends SkyboxSettings {
  scope: "domain" | "region" | "biome";
  scopeId?: number;
}

export interface DomainStore {
  domainTerrain: Partial<TerrainParams> | null;
  domainMaterial: { riverTexture?: string } | null;
  regions: Map<number, RegionRecord>;
  /** The region's BASE material (what its biomes fade into). */
  regionMaterials: Map<number, () => Promise<MaterialData>>;
  /** Keyed `${regionId}/${biomeId}`. */
  biomes: Map<string, { regionId: number; biome: BiomeRecord }>;
  biomeMaterials: Map<string, { biomeId: number; getMaterial?: () => Promise<MaterialData>; riverbed?: RiverbedMaterial }>;
  /** Keyed `${regionId}/${biomeId}/${descriptorId}`. */
  actors: Map<string, { biomeId: number; descriptor: AnyActorDescriptor }>;
  /** Keyed `${scope}/${scopeId ?? "domain"}`. */
  skyboxes: Map<string, SkyboxRecord>;
  /** Schedules a <Domain> re-commit. */
  invalidate: () => void;
}

export const createDomainStore = (invalidate: () => void): DomainStore => ({
  domainTerrain: null,
  domainMaterial: null,
  regions: new Map(),
  regionMaterials: new Map(),
  biomes: new Map(),
  biomeMaterials: new Map(),
  actors: new Map(),
  skyboxes: new Map(),
  invalidate,
});

export const DomainStoreContext = createContext<DomainStore | null>(null);

/** Bumped on every registration change; `ready` flips true after the first commit. */
export const DomainDataContext = createContext<{ registrationVersion: number; ready: boolean }>({ registrationVersion: 0, ready: false });

export const RegionContext = createContext<{ regionId: number } | null>(null);

export const BiomeContext = createContext<{ biomeId: number; regionId: number } | null>(null);

/** The spec a parent list renders at this position (<Regions> → region, <Region> → biome); the
 *  <Region>/<Biome> mounted there asserts it is that spec, so JSX can't reorder or swap them. */
export const RegionSlotContext = createContext<RegionSpec | null>(null);
export const BiomeSlotContext = createContext<BiomeSpec | null>(null);

/** Structural mistakes throw in development and log in production. */
export const reportHierarchyError = (message: string): void => {
  if (process.env.NODE_ENV === "production") console.error(message);
  else throw new Error(message);
};

export const useDomainStore = (component: string): DomainStore => {
  const store = useContext(DomainStoreContext);
  if (!store) throw new Error(`<${component}> must be mounted inside <Domain>`);
  return store;
};

/** A <Region>/<Biome> must be the one its parent's spec list put at this position. */
export const useSpecSlot = <S extends { id: number; name: string }>(Slot: Context<S | null>, spec: S, what: string, parent: string): void => {
  const expected = useContext(Slot);
  // By id + name, not identity: a hot-reloaded spec module is a new object.
  if (expected && expected.id === spec.id && expected.name === spec.name) return;
  reportHierarchyError(
    expected
      ? `<${what} spec={${spec.name}}> is mounted where the spec list has "${expected.name}" — fix the component map in ${parent}`
      : `<${what} spec={${spec.name}}> must be rendered from its parent's spec list (${parent}), not mounted directly`,
  );
};
