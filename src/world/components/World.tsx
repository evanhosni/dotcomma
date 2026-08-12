import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ObjectPool } from "../../objects/spawning/ObjectPool";
import { buildWorldConfig } from "../../workers/buildWorldConfig";
import { DEFAULT_WORLD_TERRAIN_PARAMS, setActiveWorld, WorldTerrainParams } from "../registry";
import { TerrainRenderer } from "../terrain/TerrainRenderer";
import { Biome, Region } from "../types";
import { BiomeRecord, createWorldStore, WorldDataContext, WorldStore, WorldStoreContext } from "./context";
import { SkyboxSystem } from "./Skybox";

/**
 * Root of the declarative world tree.
 *
 * Children (<Region> → <Biome> → <Terrain>/<Material>/<Actor>/<Skybox>/
 * visual components) register themselves into the world store during their
 * layout effects; this component's own layout effect runs last (parent after
 * children), assembles the same Region[]/WorldConfig data the workers have
 * always consumed, and publishes it to the module-level registry.
 *
 * Once the first commit lands, the global systems mount: the terrain chunk
 * system, the spawn system, and the skybox system. Workers are initialized
 * once with the committed config — registrations added after the first commit
 * update the registry but do not re-init already-running workers.
 */
interface WorldProps extends React.PropsWithChildren {
  /** Mount the streaming chunk terrain system (default). Worlds whose ground
   *  is a single static mesh (HomeWorld's flat plane) pass false and mount
   *  their own ground — they must then set terrain_loaded/progress themselves
   *  (the Player is gated on it) and provide their own ground collider. The
   *  world config still commits, so the analytic height pipeline
   *  (getVertexData — Player backstop/respawn) keeps working. */
  terrain?: boolean;
}

export const World = ({ terrain = true, children }: WorldProps) => {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);

  const storeRef = useRef<WorldStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createWorldStore(() => setVersion((v) => v + 1));
  }
  const store = storeRef.current;

  // Runs after all child registrations (layout effects fire child-first).
  useLayoutEffect(() => {
    commitWorld(store);
    setReady(true);
  }, [store, version]);

  const data = useMemo(() => ({ version, ready }), [version, ready]);

  return (
    <WorldStoreContext.Provider value={store}>
      <WorldDataContext.Provider value={data}>
        {children}
        {ready && (
          <>
            {terrain && <TerrainRenderer />}
            <ObjectPool />
            <SkyboxSystem />
          </>
        )}
      </WorldDataContext.Provider>
    </WorldStoreContext.Provider>
  );
};

/** Assembles Region[]/WorldConfig from the store and publishes to the registry. */
const commitWorld = (store: WorldStore) => {
  const params: WorldTerrainParams = {
    ...DEFAULT_WORLD_TERRAIN_PARAMS,
    ...(store.worldTerrain ?? {}),
  };

  // A biome definition may be mounted under several regions — aggregate all
  // its registrations into ONE shared data object (getAllBiomes dedupes by
  // identity, so sharing preserves today's behavior).
  const biomeById = new Map<number, Biome>();
  const ensureBiome = (record: BiomeRecord): Biome => {
    let data = biomeById.get(record.id);
    if (!data) {
      data = {
        name: record.name,
        id: record.id,
        joinable: record.joinable,
        blendable: record.blendable,
        blendWidth: record.blendWidth,
        actors: [],
      };
      biomeById.set(record.id, data);
    }
    return data;
  };

  for (const { biome } of store.biomes.values()) ensureBiome(biome);
  for (const { biomeId, config } of store.biomeTerrain.values()) {
    const data = biomeById.get(biomeId);
    if (!data) continue;
    if (config.noise) data.noise = config.noise;
  }
  for (const { biomeId, getMaterial } of store.biomeMaterials.values()) {
    const data = biomeById.get(biomeId);
    if (data) data.getMaterial = getMaterial;
  }
  for (const { biomeId, descriptor } of store.actors.values()) {
    const data = biomeById.get(biomeId);
    if (!data) continue;
    if (!data.actors!.some((d) => d.id === descriptor.id)) data.actors!.push(descriptor);
  }

  // Regions in JSX order; each region's biomes in JSX order.
  const regions: Region[] = [];
  for (const record of store.regions.values()) {
    const biomes: Biome[] = [];
    for (const { regionId, biome } of store.biomes.values()) {
      if (regionId !== record.id) continue;
      const data = biomeById.get(biome.id)!;
      if (!biomes.includes(data)) biomes.push(data);
    }
    regions.push({
      name: record.name,
      id: record.id,
      biomes,
      getMaterial: store.regionMaterials.get(record.id),
    });
  }

  setActiveWorld({
    regions,
    params,
    config: buildWorldConfig(regions, params),
    riverTexture: store.worldMaterial?.riverTexture ?? "blue_mud.jpg",
  });
};
