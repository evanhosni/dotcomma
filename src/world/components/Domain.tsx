import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { ActorPool } from "../../objects/actors/spawning/ActorPool";
import { mergeActorListings } from "../../objects/actors/spec";
import type { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { childOfKind, childrenOfKind, declare, driversIn, nodeOf } from "../content";
import { actorPlacementsOf, domainConfigOf, terrainParamsOf, type BiomeIdentity, type RegionIdentity } from "../content/config";
import type { ContentNode } from "../content/types";
import { DEFAULT_RIVER_TEXTURE, DEFAULT_SCENE_BACKGROUND } from "../defaults";
import { setActiveDomain } from "../domains/utils";
import { SkyboxSystem, skyboxesOf } from "../sky/Skybox";
import { TerrainRenderer } from "../terrain";
import type { Biome, Region } from "../types";
import { materialBuilderOf, type MaterialProps } from "./Material";
import { descriptorOfMount } from "./Actor";
import { DomainReadyContext } from "./context";

export interface DomainProps {
  /** false = the domain mounts its own ground and sets terrainLoaded/progress itself. */
  terrain?: boolean;
  /** Per-domain because the canvas persists across switches. */
  background?: string;
  /** FEET position. Unset = the default sky drop (or whatever the domain's own traveler sets). */
  playerSpawn?: [number, number, number];
  children?: ReactNode;
}

/** The LOOK half of the tree: what the one terrain material is assembled from. The generation half
 *  is the DomainConfig (world/content/config.ts); both come off the same children. */
const lookOf = (domain: ContentNode<any>): { regions: Region[]; riverTexture: string } => {
  const biomeLook = (node: ContentNode<BiomeIdentity>): Biome => {
    const material = childOfKind<MaterialProps>(node, "material");
    return {
      id: node.props.id,
      name: node.props.name,
      getMaterial: material ? materialBuilderOf(material.props) : undefined,
      riverbed: material?.props.riverbed,
    };
  };
  return {
    regions: childrenOfKind<RegionIdentity>(domain, "region").map((node) => {
      const material = childOfKind<MaterialProps>(node, "material");
      return {
        id: node.props.id,
        name: node.props.name,
        biomes: childrenOfKind<BiomeIdentity>(node, "biome").map(biomeLook),
        getMaterial: material ? materialBuilderOf(material.props) : undefined,
      };
    }),
    riverTexture: childOfKind<MaterialProps>(domain, "material")?.props.riverTexture ?? DEFAULT_RIVER_TEXTURE,
  };
};

/** Every <Actor> every biome mounts, as ONE descriptor per kind spawning in the union of its biomes. */
const actorsOf = (domain: ContentNode<any>): AnyActorDescriptor[] =>
  mergeActorListings(
    childrenOfKind<RegionIdentity>(domain, "region").flatMap((region) =>
      childrenOfKind<BiomeIdentity>(region, "biome").flatMap((biome) =>
        actorPlacementsOf(biome).map(({ id, mount, feature }) => descriptorOfMount(mount, id, biome.props.id, feature)),
      ),
    ),
  );

/**
 * THE ROOT of a world. Its children are the whole description of it — regions, their biomes, and
 * everything mounted in those — read once here as DATA (world/content/) and published for the
 * workers, the Player and the server-shared config. Nothing is registered, and there is no second
 * list to keep in step: a thing is in the world because it is in this tree.
 *
 * It then mounts exactly the systems the tree asked for: every mounted kind's Driver, once.
 */
export const Domain = declare<DomainProps>({
  kind: "domain",
  within: null,
  View: ({ terrain = true, background = DEFAULT_SCENE_BACKGROUND, playerSpawn, children }) => {
    const [ready, setReady] = useState(false);
    const { scene } = useThree();
    const { setPlayerSpawn, setTerrainLoaded, setProgress } = useGameContext();

    const domain = nodeOf(Domain.content, {}, children);
    const drivers = useMemo(() => driversIn(domain.children), [domain]);

    useLayoutEffect(() => {
      const { regions, riverTexture } = lookOf(domain);
      setActiveDomain({
        regions,
        riverTexture,
        params: terrainParamsOf(domain),
        config: domainConfigOf(domain),
        skyboxes: skyboxesOf(domain),
        actors: actorsOf(domain),
      });
      setReady(true);
    }, [domain]);

    useLayoutEffect(() => {
      scene.background = new THREE.Color(background);
      return () => {
        scene.background = new THREE.Color(DEFAULT_SCENE_BACKGROUND);
      };
    }, [scene, background]);

    // The terrain gate resets on UNMOUNT only: child effects run before this one, so a mount-time
    // reset would clobber HomeGround's / TerrainRenderer's.
    useEffect(() => {
      if (playerSpawn) setPlayerSpawn(playerSpawn);
      return () => {
        setPlayerSpawn(null);
        setTerrainLoaded(false);
        setProgress(0);
      };
    }, [setPlayerSpawn, setTerrainLoaded, setProgress, playerSpawn?.[0], playerSpawn?.[1], playerSpawn?.[2]]);

    return (
      <DomainReadyContext.Provider value={ready}>
        {children}
        {ready && (
          <>
            {terrain && <TerrainRenderer />}
            <ActorPool />
            <SkyboxSystem />
            {drivers.map(({ kind, Driver }) => (
              <Driver key={kind} />
            ))}
          </>
        )}
      </DomainReadyContext.Provider>
    );
  },
});
