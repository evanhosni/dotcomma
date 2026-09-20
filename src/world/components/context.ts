import { createContext, useContext } from "react";
import { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { BiomeNoiseConfig, MaterialData, RegionMaterialData, TerrainParams } from "../types";

// Registration store behind the <Domain> tree. Map insertion order = JSX order,
// which voronoi assignment depends on.

export interface RegionRecord {
  id: number;
  name: string;
}

export interface BiomeRecord {
  id: number;
  name: string;
  joinable: boolean;
  blendable: boolean;
  blendWidth?: number;
}

export interface BiomeTerrainConfig {
  noise?: BiomeNoiseConfig;
}

/** Reserved — no region-level terrain rules exist yet. */
export type RegionTerrainConfig = Record<string, unknown>;

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
  regionTerrain: Map<number, RegionTerrainConfig>;
  regionMaterials: Map<number, () => Promise<RegionMaterialData>>;
  /** Keyed `${regionId}/${biomeId}` — the same biome may appear in several regions. */
  biomes: Map<string, { regionId: number; biome: BiomeRecord }>;
  biomeTerrain: Map<string, { biomeId: number; config: BiomeTerrainConfig }>;
  biomeMaterials: Map<string, { biomeId: number; getMaterial: () => Promise<MaterialData> }>;
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
  regionTerrain: new Map(),
  regionMaterials: new Map(),
  biomes: new Map(),
  biomeTerrain: new Map(),
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

export const useDomainStore = (component: string): DomainStore => {
  const store = useContext(DomainStoreContext);
  if (!store) throw new Error(`<${component}> must be mounted inside <Domain>`);
  return store;
};
