import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useGameContext } from "../../../context/hooks";
import { prefetchTerrainAround } from "../../terrain/build-requests";
import { ensureVertexCompute, getVertexData, getVertexSample } from "../../terrain/utils";
import { replaceAddressPath } from "../navigation";
import { pathForPlace } from "./address";
import { debugGlobal } from "../../../utils/utils";
import { onPlaceChange } from "../../place/store";

/**
 * The overworld's URL ↔ position glue: keeps the address bar on the player's current region + biome cells
 * (while the intro does not hold it, world/domains/navigation/index.ts), and the debug teleport. Entering
 * the world is the intro's (intro/Intro.tsx). Renders nothing.
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
    const landAt = async (x: number, z: number, y?: number) => {
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
      setPlayerSpawn([x, ground, z]);
    };

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
