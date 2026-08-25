import { createContext, useContext } from "react";
import { ActorDescriptor } from "../../objects/actors/spawning/types";
import { BiomeNoiseConfig, MaterialData, RegionMaterialData, TerrainParams } from "../types";

/**
 * Registration store backing the <Domain> component tree.
 *
 * Config components (<Region>, <Biome>, <Terrain>, <Material>, <Skybox>,
 * <Actor>) write into these maps from useLayoutEffect and call
 * invalidate(); <Domain> commits the assembled world after layout effects
 * settle. Map insertion order follows JSX tree order, which preserves
 * region/biome ordering (voronoi assignment depends on it).
 */

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

/** Reserved — no region-level terrain rules exist yet. Registered so future
 *  systems can consume per-region terrain props without new plumbing. */
export type RegionTerrainConfig = Record<string, unknown>;

export interface SkyboxSettings {
  topColor: string;
  horizonColor: string;
  bottomColor: string;
  radius: number;
}

export interface SkyboxRecord extends SkyboxSettings {
  scope: "domain" | "region" | "biome";
  scopeId?: number; // region or biome id for scoped skyboxes
}

export interface DomainStore {
  domainTerrain: Partial<TerrainParams> | null;
  domainMaterial: { riverTexture?: string } | null;
  regions: Map<number, RegionRecord>;
  regionTerrain: Map<number, RegionTerrainConfig>;
  regionMaterials: Map<number, () => Promise<RegionMaterialData>>;
  /** key: `${regionId}/${biomeId}` — the same biome may appear in several regions */
  biomes: Map<string, { regionId: number; biome: BiomeRecord }>;
  /** key: `${regionId}/${biomeId}` */
  biomeTerrain: Map<string, { biomeId: number; config: BiomeTerrainConfig }>;
  /** key: `${regionId}/${biomeId}` */
  biomeMaterials: Map<string, { biomeId: number; getMaterial: () => Promise<MaterialData> }>;
  /** key: `${regionId}/${biomeId}/${descriptorId}` */
  actors: Map<string, { biomeId: number; descriptor: ActorDescriptor }>;
  /** key: `${scope}/${scopeId ?? "domain"}` */
  skyboxes: Map<string, SkyboxRecord>;
  /** Schedules a <Domain> re-commit. Safe to call from effects/cleanups. */
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
export const DomainDataContext = createContext<{ version: number; ready: boolean }>({ version: 0, ready: false });

export const RegionContext = createContext<{ regionId: number } | null>(null);

export const BiomeContext = createContext<{ biomeId: number; regionId: number } | null>(null);

export const useDomainStore = (component: string): DomainStore => {
  const store = useContext(DomainStoreContext);
  if (!store) throw new Error(`<${component}> must be mounted inside <Domain>`);
  return store;
};
