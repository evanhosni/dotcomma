import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useGameContext } from "../../../context/GameContext";
import { prefetchTerrainAround } from "../../terrain/buildRequests";
import { ensureVertexCompute, getVertexData, getVertexSample } from "../../terrain/vertexData";
import { replaceAddressPath, takePendingAddress } from "../navigation";
import { type Address, addressOfPosition, pathForPlace, resolveAddress } from "./address";
import { debugGlobal } from "../../../utils/utils";
import { onPlaceChange } from "../../place";

/** Entering the overworld starts this far above the landing site: the player falls while the ground loads
 *  (~10s at TERMINAL_VELOCITY, physics/characterMovement.ts). */
const ENTRY_DROP_HEIGHT = 1500;

/**
 * The overworld's URL ↔ position glue. On mount it resolves the pending address (none:
 * the biome cell the world origin sits in) to a world point and DROPS the player there
 * from ENTRY_DROP_HEIGHT: the terrain gate closes (terrainLoaded false), the player's
 * spawn moves, and the Player's hold-at-spawn branch lets the capsule fall toward it
 * until TerrainRenderer has built the ground under it. Afterwards it keeps the address
 * bar on the player's current region + biome cells. Renders nothing.
 */
export const FastTravel = () => {
  const { setPlayerSpawn, setTerrainLoaded, setProgress } = useGameContext();
  const currentKey = useRef<string | null>(null);

  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    let cancelled = false;

    // Closes the terrain gate and moves the spawn onto the ground (or the water) at (x, z). With `y` (the
    // debug teleport into a tunnel) the gate stays open: closing it would drop the player from 100u above,
    // onto the street over the tunnel.
    const landAt = async (x: number, z: number, y?: number, dropHeight?: number) => {
      // The terrain worker starts on the destination while the height lookup round-trips.
      prefetchTerrainAround(x, z);
      if (y !== undefined) {
        setPlayerSpawn([x, y, z]);
        return;
      }
      // Padded height in the worker when it is up (a flatten-tile miss is 30–70ms on the main thread).
      const vd = (await getVertexSample(x, z)) ?? (await getVertexData(x, z));
      if (cancelled) return;
      setTerrainLoaded(false);
      setProgress(0);
      // Land ABOVE water: a lake cell's site is on the lake bed.
      const ground = Number.isNaN(vd.waterHeight) ? vd.height : Math.max(vd.height, vd.waterHeight);
      setPlayerSpawn([x, ground, z], dropHeight);
    };

    const enter = async (address: Address | null) => {
      await ensureVertexCompute();
      if (cancelled) return;
      // No/unresolvable address: the biome cell the world origin sits in.
      const resolved = (address && resolveAddress(address)) ?? addressOfPosition(0, 0);
      currentKey.current = resolved.path;
      replaceAddressPath(resolved.path);
      await landAt(resolved.site.x, resolved.site.z, undefined, ENTRY_DROP_HEIGHT);
    };

    enter(takePendingAddress());

    // Console/debug access only (like __game / __net): teleport to raw world coordinates.
    const travelTo = async (x: number, z: number, y?: number) => {
      await ensureVertexCompute();
      if (cancelled) return;
      await landAt(x, z, y);
    };
    const removeDebugGlobal = debugGlobal("__dotcomma", { travelTo, camera, scene });

    return () => {
      cancelled = true;
      removeDebugGlobal();
    };
  }, [camera, scene, setPlayerSpawn, setTerrainLoaded, setProgress]);

  useEffect(
    () =>
      onPlaceChange((place) => {
        if (!place) return;
        ensureVertexCompute().then(() => {
          const path = pathForPlace(place);
          if (path === currentKey.current) return;
          currentKey.current = path;
          replaceAddressPath(path);
        });
      }),
    [],
  );

  return null;
};
