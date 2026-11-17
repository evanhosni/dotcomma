/**
 * WHERE THE PLAYER IS: region, biome, address cells, the sky's region weights and the ground underfoot,
 * polled ONCE for everyone (the sky, the address bar, the dev overlay) by <PlaceTracker>, which every
 * <Domain> mounts. A module-level store, not a React context: it changes twice a second and is read
 * from frame loops; a context would re-render the tree on every poll. Position itself is per frame:
 * GameContext's `playerPosition`.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useGameContext } from "../../context/hooks";
import { getPlaceInfo } from "../../objects/dressing/worker";
import { getAllBiomes } from "../../utils/utils";
import { getActiveRegions } from "../domains/store";
import { isCameraUnderground } from "../shaders/terrain-holes/store";
import { publish } from "./store";

const POLL_INTERVAL_S = 0.5;

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
