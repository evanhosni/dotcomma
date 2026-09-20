import { useThree } from "@react-three/fiber";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { ActorPool } from "../../objects/actors/spawning/ActorPool";
import { buildDomainConfig } from "../../utils/workers/buildDomainConfig";
import { DEFAULT_RIVER_TEXTURE, DEFAULT_SCENE_BACKGROUND, DEFAULT_TERRAIN_PARAMS } from "../defaults";
import { setActiveDomain } from "../domains/utils";
import { TerrainRenderer } from "../terrain/TerrainRenderer";
import { Biome, Region, TerrainParams } from "../types";
import { BiomeRecord, createDomainStore, DomainDataContext, DomainStore, DomainStoreContext } from "./context";
import { SkyboxSystem } from "../sky/Skybox";

/** Root of the declarative DOMAIN → REGION → BIOME tree: children register into
 *  the store during their layout effects, this component commits the assembled
 *  Region[]/DomainConfig to the active-domain accessors, then mounts the global
 *  systems. Workers init once from the first commit (see CLAUDE.md). */
interface DomainProps extends React.PropsWithChildren {
  /** false = the domain mounts its own static ground and must set
   *  terrainLoaded/progress itself (the Player is gated on them). */
  terrain?: boolean;
  /** Per-domain because the canvas persists across domain switches. */
  background?: string;
  /** FEET position. Unset = the default sky drop onto the terrain. */
  playerSpawn?: [number, number, number];
}

export const Domain = ({ terrain = true, background = DEFAULT_SCENE_BACKGROUND, playerSpawn, children }: DomainProps) => {
  const [registrationVersion, setRegistrationVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const { scene } = useThree();
  const { setPlayerSpawn, setTerrainLoaded, setProgress } = useGameContext();

  // The terrain gate resets on UNMOUNT only: child effects run before this one,
  // so a mount-time reset would clobber HomeGround's/TerrainRenderer's.
  useLayoutEffect(() => {
    scene.background = new THREE.Color(background);
    return () => {
      scene.background = new THREE.Color(DEFAULT_SCENE_BACKGROUND);
    };
  }, [scene, background]);
  useEffect(() => {
    setPlayerSpawn(playerSpawn ?? null);
    return () => {
      setPlayerSpawn(null);
      setTerrainLoaded(false);
      setProgress(0);
    };
  }, [setPlayerSpawn, setTerrainLoaded, setProgress, playerSpawn?.[0], playerSpawn?.[1], playerSpawn?.[2]]);

  const storeRef = useRef<DomainStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createDomainStore(() => setRegistrationVersion((v) => v + 1));
  }
  const store = storeRef.current;

  // Layout effects fire child-first, so every registration has landed.
  useLayoutEffect(() => {
    commitDomain(store);
    setReady(true);
  }, [store, registrationVersion]);

  const data = useMemo(() => ({ registrationVersion, ready }), [registrationVersion, ready]);

  return (
    <DomainStoreContext.Provider value={store}>
      <DomainDataContext.Provider value={data}>
        {children}
        {ready && (
          <>
            {terrain && <TerrainRenderer />}
            <ActorPool />
            <SkyboxSystem />
          </>
        )}
      </DomainDataContext.Provider>
    </DomainStoreContext.Provider>
  );
};

const commitDomain = (store: DomainStore) => {
  const params: TerrainParams = {
    ...DEFAULT_TERRAIN_PARAMS,
    ...(store.domainTerrain ?? {}),
  };

  // A biome mounted under several regions becomes ONE shared object (getAllBiomes dedupes by identity).
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

  // JSX order — voronoi assignment depends on it.
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
      getBoundaryMaterial: store.regionMaterials.get(record.id),
    });
  }

  setActiveDomain({
    regions,
    params,
    config: buildDomainConfig(regions, params),
    riverTexture: store.domainMaterial?.riverTexture ?? DEFAULT_RIVER_TEXTURE,
  });
};
