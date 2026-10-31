import * as THREE from "three";
import type { DEV_TOGGLES } from "./constants";

export interface GameContextType {
  playerPosition: THREE.Vector3;
  progress: number;
  setProgress: (progress: number) => void;
  terrainLoaded: boolean;
  setTerrainLoaded: (terrainLoaded: boolean) => void;
  /** FEET position from <Domain playerSpawn>; null = the default sky drop. */
  playerSpawn: [number, number, number] | null;
  /** How far above the spawn the player starts falling while the ground loads; null = the Player's
   *  default hold height. */
  spawnDropHeight: number | null;
  setPlayerSpawn: (spawn: [number, number, number] | null, dropHeight?: number | null) => void;
}

export type DevToggleFlag = (typeof DEV_TOGGLES)[number]["flag"];
/** One boolean per DEV_TOGGLES entry. */
export type DevToggleFlags = Record<DevToggleFlag, boolean>;

export type DevContextType = DevToggleFlags & {
  /** The saved setting (save/: settings.devmode), synced with the URL's `?devmode=true` (DevContext.tsx). */
  devMode: boolean;
  /** Saves devmode on/off; the URL follows. */
  setDevMode: (on: boolean) => void;
  setToggle: (flag: DevToggleFlag, on: boolean) => void;
};
