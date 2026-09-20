import * as THREE from "three";
import React from "react";
import { Chunk } from "../world/terrain/types";

export interface GameContextType {
  playerPosition: THREE.Vector3;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  setChunks: (chunks: { [key: string]: { position: number[]; chunk: Chunk } }) => void;
  progress: number;
  setProgress: (progress: number) => void;
  terrainLoaded: boolean;
  setTerrainLoaded: (terrainLoaded: boolean) => void;
  /** FEET position from <Domain playerSpawn>; null = the default sky drop. */
  playerSpawn: [number, number, number] | null;
  setPlayerSpawn: (spawn: [number, number, number] | null) => void;
  /** LOD1/LOD2 chunks still pending build. */
  terrainHighLODPending: React.MutableRefObject<boolean>;
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
