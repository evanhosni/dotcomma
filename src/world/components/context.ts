import { createContext, useContext } from "react";
import { SpawnDescriptor } from "../../objects/spawning/types";
import { WorldTerrainParams } from "../registry";
import { BiomeNoiseConfig, MaterialData, RegionMaterialData } from "../types";

/**
 * Registration store backing the <World> component tree.
 *
 * Config components (<Region>, <Biome>, <Terrain>, <Material>, <Skybox>,
 * <Spawnable>) write into these maps from useLayoutEffect and call
 * invalidate(); <World> commits the assembled world after layout effects
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
  scope: "world" | "region" | "biome";
  scopeId?: number; // region or biome id for scoped skyboxes
}

export interface WorldStore {
  worldTerrain: Partial<WorldTerrainParams> | null;
  worldMaterial: { riverTexture?: string } | null;
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
  spawnables: Map<string, { biomeId: number; descriptor: SpawnDescriptor }>;
  /** key: `${scope}/${scopeId ?? "world"}` */
  skyboxes: Map<string, SkyboxRecord>;
  /** Schedules a <World> re-commit. Safe to call from effects/cleanups. */
  invalidate: () => void;
}

export const createWorldStore = (invalidate: () => void): WorldStore => ({
  worldTerrain: null,
  worldMaterial: null,
  regions: new Map(),
  regionTerrain: new Map(),
  regionMaterials: new Map(),
  biomes: new Map(),
  biomeTerrain: new Map(),
  biomeMaterials: new Map(),
  spawnables: new Map(),
  skyboxes: new Map(),
  invalidate,
});

export const WorldStoreContext = createContext<WorldStore | null>(null);

/** Bumped on every registration change; `ready` flips true after the first commit. */
export const WorldDataContext = createContext<{ version: number; ready: boolean }>({ version: 0, ready: false });

export const RegionContext = createContext<{ regionId: number } | null>(null);

export const BiomeContext = createContext<{ biomeId: number; regionId: number } | null>(null);

export const useWorldStore = (component: string): WorldStore => {
  const store = useContext(WorldStoreContext);
  if (!store) throw new Error(`<${component}> must be mounted inside <World>`);
  return store;
};
