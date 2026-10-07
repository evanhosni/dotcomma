import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useGameContext } from "../../../context/GameContext";
import { getPlaceInfo } from "../../../objects/dressing/dressingWorker";
import { prefetchTerrainAround } from "../../terrain/buildRequests";
import { ensureVertexCompute, getVertexData, getVertexSample } from "../../terrain/vertexData";
import { ADDRESS_TRAVEL_EVENT } from "../constants";
import { replaceAddressPath, takePendingAddress } from "../navigation";
import { type Address, addressOfPosition, pathForPlace, resolveAddress } from "./address";

const ADDRESS_POLL_INTERVAL_S = 1;

/**
 * The overworld's URL ↔ position glue. On mount and on every ADDRESS_TRAVEL_EVENT
 * it resolves the pending address to a world point and TELEPORTS: the terrain gate
 * closes (terrainLoaded false), the player's spawn moves, and the Player's
 * hold-at-spawn branch carries the capsule there until TerrainRenderer has built
 * the ground under it. Between travels it keeps the address bar on the player's
 * current region + biome cells. Renders nothing.
 */
export const FastTravel = () => {
  const { setPlayerSpawn, setTerrainLoaded, setProgress, playerPosition } = useGameContext();
  const pollTimer = useRef(0);
  const pollInFlight = useRef(false);
  const currentKey = useRef<string | null>(null);

  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    let cancelled = false;

    // Closes the terrain gate and moves the spawn onto the ground (or the water) at (x, z).
    const landAt = async (x: number, z: number) => {
      // The terrain worker starts on the destination while the height lookup round-trips.
      prefetchTerrainAround(x, z);
      // Padded height in the worker when it is up (a flatten-tile miss is 30–70ms on the main thread).
      const vd = (await getVertexSample(x, z)) ?? (await getVertexData(x, z));
      if (cancelled) return;
      setTerrainLoaded(false);
      setProgress(0);
      // Land ABOVE water: a lake cell's site is on the lake bed.
      const ground = Number.isNaN(vd.waterHeight) ? vd.height : Math.max(vd.height, vd.waterHeight);
      setPlayerSpawn([x, ground, z]);
    };

    const travel = async (address: Address | null) => {
      await ensureVertexCompute();
      if (cancelled) return;
      // No/unresolvable address: the biome cell the world origin sits in.
      const resolved = (address && resolveAddress(address)) ?? addressOfPosition(0, 0);
      currentKey.current = resolved.path;
      replaceAddressPath(resolved.path);
      await landAt(resolved.site.x, resolved.site.z);
    };

    travel(takePendingAddress());
    const onTravel = () => {
      travel(takePendingAddress());
    };
    window.addEventListener(ADDRESS_TRAVEL_EVENT, onTravel);

    // Console/debug access only (like __game / __net): teleport to raw world coordinates.
    const travelTo = async (x: number, z: number) => {
      await ensureVertexCompute();
      if (cancelled) return;
      await landAt(x, z);
    };
    (window as any).__dotcomma = { travelTo, camera, scene };

    return () => {
      cancelled = true;
      window.removeEventListener(ADDRESS_TRAVEL_EVENT, onTravel);
      delete (window as any).__dotcomma;
    };
  }, [camera, scene, setPlayerSpawn, setTerrainLoaded, setProgress]);

  useFrame((_, delta) => {
    if (pollInFlight.current) return;
    pollTimer.current += delta;
    if (pollTimer.current < ADDRESS_POLL_INTERVAL_S) return;
    pollTimer.current = 0;
    pollInFlight.current = true;
    getPlaceInfo(playerPosition.x, playerPosition.z)
      .then(async (place) => {
        if (!place) return;
        await ensureVertexCompute();
        const path = pathForPlace(place);
        if (path === currentKey.current) return;
        currentKey.current = path;
        replaceAddressPath(path);
      })
      .catch(() => undefined)
      .finally(() => {
        pollInFlight.current = false;
      });
  });

  return null;
};
