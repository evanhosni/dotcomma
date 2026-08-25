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

/**
 * Root of the declarative domain tree (the top of the DOMAIN → REGION →
 * BIOME hierarchy).
 *
 * Children (<Region> → <Biome> → <Terrain>/<Material>/<Actor>/<Skybox>/
 * visual components) register themselves into the domain store during their
 * layout effects; this component's own layout effect runs last (parent after
 * children), assembles the same Region[]/DomainConfig data the workers have
 * always consumed, and publishes it to the module-level active-domain
 * accessors (domains/utils.ts).
 *
 * Once the first commit lands, the global systems mount: the terrain chunk
 * system, the spawn system, and the skybox system. Workers are initialized
 * once with the committed config — registrations added after the first commit
 * update the accessors but do not re-init already-running workers.
 */
interface DomainProps extends React.PropsWithChildren {
  /** Mount the streaming chunk terrain system (default). Domains whose ground
   *  is a single static mesh (HomeDomain's flat plane) pass false and mount
   *  their own ground — they must then set terrain_loaded/progress themselves
   *  (the Player is gated on it) and provide their own ground collider. The
   *  domain config still commits, so the analytic height pipeline
   *  (getVertexData — Player backstop/respawn) keeps working. */
  terrain?: boolean;
  /** Scene background color (default DEFAULT_SCENE_BACKGROUND; the home page
   *  is black). The canvas persists across domain switches, so this is a
   *  domain attribute, not a canvas prop. */
  background?: string;
  /** Where the player's FEET spawn (ground-level). Unset = the default sky
   *  drop onto the terrain. Home page: [0, 0, 0]. */
  playerSpawn?: [number, number, number];
}

export const Domain = ({ terrain = true, background = DEFAULT_SCENE_BACKGROUND, playerSpawn, children }: DomainProps) => {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const { scene } = useThree();
  const { setPlayerSpawn, setTerrainLoaded, setProgress } = useGameContext();

  // The canvas, physics world, Player and GameContext all OUTLIVE a domain
  // (index.tsx swaps domains inside ONE persistent <CustomCanvas>, so a
  // switch never loses the GL context or recompiles shaders). Per-domain
  // scene state therefore lives here: background, player spawn, and — on
  // unmount ONLY — the terrain gate reset, so the Player holds at the next
  // domain's spawn until its ground exists. Not on mount: child effects run
  // BEFORE this one, and HomeGround/TerrainRenderer set terrain_loaded from
  // theirs — resetting here afterwards would clobber them.
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
    storeRef.current = createDomainStore(() => setVersion((v) => v + 1));
  }
  const store = storeRef.current;

  // Runs after all child registrations (layout effects fire child-first).
  useLayoutEffect(() => {
    commitDomain(store);
    setReady(true);
  }, [store, version]);

  const data = useMemo(() => ({ version, ready }), [version, ready]);

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

/** Assembles Region[]/DomainConfig from the store and publishes it as the active domain. */
const commitDomain = (store: DomainStore) => {
  const params: TerrainParams = {
    ...DEFAULT_TERRAIN_PARAMS,
    ...(store.domainTerrain ?? {}),
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

  setActiveDomain({
    regions,
    params,
    config: buildDomainConfig(regions, params),
    riverTexture: store.domainMaterial?.riverTexture ?? DEFAULT_RIVER_TEXTURE,
  });
};
