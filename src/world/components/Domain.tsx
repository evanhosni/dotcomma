import { useThree } from "@react-three/fiber";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { ActorPool } from "../../objects/actors/spawning/ActorPool";
import { buildDomainConfig } from "../domains/buildDomainConfig";
import { DEFAULT_RIVER_TEXTURE, DEFAULT_SCENE_BACKGROUND, DEFAULT_TERRAIN_PARAMS } from "../defaults";
import { DOMAIN_CONFIGS } from "../domains/configs";
import { getCurrentDomain } from "../domains/navigation";
import { setActiveDomain } from "../domains/utils";
import { TerrainRenderer } from "../terrain/TerrainRenderer";
import { Biome, Region, TerrainParams } from "../types";
import type { DomainConfig } from "../../utils/workers/vertexCompute";
import { createDomainStore, DomainDataContext, DomainStore, DomainStoreContext } from "./context";
import { reportContentError } from "../../utils/contentError";
import { SkyboxSystem } from "../sky/Skybox";

/** Root of the DOMAIN → REGION → BIOME tree: children register during layout
 *  effects, this commits the Region[]/DomainConfig and mounts the global systems. */
interface DomainProps extends React.PropsWithChildren {
  /** false = the domain mounts its own ground and sets terrainLoaded/progress itself. */
  terrain?: boolean;
  /** Per-domain because the canvas persists across switches. */
  background?: string;
  /** FEET position. Unset = the default sky drop (or whatever the domain's own traveler sets). */
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
    if (playerSpawn) setPlayerSpawn(playerSpawn);
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

/** Every registered biome as ONE object per id (a biome under several regions is one shared object —
 *  getAllBiomes dedupes by identity), with its material, riverbed and actors merged in. */
const mergeBiomes = (store: DomainStore): Map<number, Biome> => {
  const biomeById = new Map<number, Biome>();
  for (const { biome: record } of store.biomes.values()) {
    const data = biomeById.get(record.id);
    if (data && data.name !== record.name) {
      reportContentError(`biome id ${record.id} is used by both "${data.name}" and "${record.name}" — biome ids must be unique (a biome shared by two regions keeps one id AND one spec)`);
    }
    if (data) continue;
    biomeById.set(record.id, {
      name: record.name,
      id: record.id,
      joinable: record.joinable,
      blendWidth: record.blendWidth,
      heightBlendWidth: record.heightBlendWidth,
      water: record.water,
      prohibitRoads: record.prohibitRoads,
      prohibitRivers: record.prohibitRivers,
      noise: record.noise,
      actors: [],
    });
  }
  for (const { biomeId, getMaterial, riverbed } of store.biomeMaterials.values()) {
    const data = biomeById.get(biomeId);
    if (!data) continue;
    if (getMaterial) data.getMaterial = getMaterial;
    if (riverbed) data.riverbed = riverbed;
  }
  for (const { biomeId, descriptor } of store.actors.values()) {
    const data = biomeById.get(biomeId);
    if (!data) continue;
    if (!data.actors!.some((d) => d.id === descriptor.id)) data.actors!.push(descriptor);
  }
  return biomeById;
};

/** The regions in registration order, each with its biomes in registration order — voronoi
 *  assignment depends on both. */
const assembleRegions = (store: DomainStore, biomeById: ReadonlyMap<number, Biome>): Region[] => {
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
      baseNoise: record.baseNoise,
      blendWidth: record.blendWidth,
      heightBlendWidth: record.heightBlendWidth,
      riverProbability: record.riverProbability,
      getMaterial: store.regionMaterials.get(record.id),
    });
  }
  return regions;
};

const commitDomain = (store: DomainStore) => {
  const params: TerrainParams = {
    ...DEFAULT_TERRAIN_PARAMS,
    ...(store.domainTerrain ?? {}),
  };
  const regions = assembleRegions(store, mergeBiomes(store));
  const config = buildDomainConfig(regions, params);
  verifySharedConfig(config);
  setActiveDomain({
    regions,
    params,
    config,
    riverTexture: store.domainMaterial?.riverTexture ?? DEFAULT_RIVER_TEXTURE,
  });
};

/** DEV GUARD: the SERVER simulates on the domain's shared config.ts, not on this
 *  JSX commit; same assembler ⇒ byte-identical unless a mount is missing there. */
const verifySharedConfig = (config: DomainConfig): void => {
  if (process.env.NODE_ENV === "production") return;
  const shared = DOMAIN_CONFIGS[getCurrentDomain()];
  if (!shared) return;
  if (JSON.stringify(config) === JSON.stringify(shared)) return;
  const keys = (Object.keys(config) as (keyof DomainConfig)[]).filter(
    (k) => JSON.stringify(config[k]) !== JSON.stringify(shared[k]),
  );
  console.error(
    `[domain] the JSX commit and the shared config (world/domains/${getCurrentDomain()}/config.ts — what the SERVER simulates on) ` +
      `differ in: ${keys.join(", ")}. Update the domain's config.ts (or the region/biome spec it reads) so the server's terrain matches the client's.`,
  );
};
