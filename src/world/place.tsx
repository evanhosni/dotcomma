import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useGameContext } from "../context/GameContext";
import { getPlaceInfo, type PlaceInfo } from "../objects/dressing/worker";
import { getAllBiomes } from "../utils/utils";
import { getActiveRegions } from "./domains/utils";
import { isCameraUnderground } from "./shaders/terrainHoles";

/**
 * WHERE THE PLAYER IS: region, biome, address cells, the sky's region weights and the ground underfoot,
 * polled ONCE for everyone (the sky, the address bar, the dev overlay) by <PlaceTracker>, which every
 * <Domain> mounts. A module-level store, not a React context: it changes twice a second and is read
 * from frame loops; a context would re-render the tree on every poll. Position itself is per frame:
 * GameContext's `playerPosition`.
 */

const POLL_INTERVAL_S = 0.5;

export interface PlayerPlace extends PlaceInfo {
  regionName: string;
  biomeName: string;
  /** utils/workers/ground.ts ("road", "snow", "water", …, else the biome's name); "tunnel" underground. */
  ground: string;
}

let current: PlayerPlace | null = null;
const listeners = new Set<(place: PlayerPlace | null) => void>();

/** null until the first poll of this domain answers. */
export const getPlace = (): PlayerPlace | null => current;

/** Called with every poll's answer (and null on a domain switch). Returns its remover. */
export const onPlaceChange = (fn: (place: PlayerPlace | null) => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const publish = (place: PlayerPlace | null): void => {
  current = place;
  listeners.forEach((fn) => fn(place));
};

/** Domain-switch teardown (world/domains/reset.ts). */
export const resetPlace = (): void => publish(null);

/** The one poller; mounted by <Domain>. */
export const PlaceTracker = () => {
  const { playerPosition } = useGameContext();
  const elapsed = useRef(POLL_INTERVAL_S);
  const inFlight = useRef(false);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (inFlight.current || elapsed.current < POLL_INTERVAL_S) return;
    elapsed.current = 0;
    inFlight.current = true;
    getPlaceInfo(playerPosition.x, playerPosition.z)
      .then((info) => {
        if (!info) return;
        const regions = getActiveRegions();
        publish({
          ...info,
          regionName: regions.find((r) => r.id === info.regionId)?.name ?? "?",
          biomeName: getAllBiomes(regions).find((b) => b.id === info.biomeId)?.name ?? "?",
          ground: isCameraUnderground() ? "tunnel" : info.ground,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  });

  return null;
};
