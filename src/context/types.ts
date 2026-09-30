import * as THREE from "three";

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

export interface DevContextType {
  /** Toggled by F1; mirrored to the `?devmode` URL param so a refresh keeps it. */
  devMode: boolean;
  noclip: boolean;
  physicsDebug: boolean;
  toggleDevMode: () => void;
  setNoclip: (noclip: boolean) => void;
  setPhysicsDebug: (physicsDebug: boolean) => void;
}
