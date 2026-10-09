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
  setPlayerSpawn: (spawn: [number, number, number] | null) => void;
}

export type DevToggleFlag = (typeof DEV_TOGGLES)[number]["flag"];
/** One boolean per DEV_TOGGLES entry. */
export type DevToggleFlags = Record<DevToggleFlag, boolean>;

export type DevContextType = DevToggleFlags & {
  /** Toggled by F1; the URL says `?devmode=true` while on, so a refresh keeps it. */
  devMode: boolean;
  toggleDevMode: () => void;
  setToggle: (flag: DevToggleFlag, on: boolean) => void;
};
