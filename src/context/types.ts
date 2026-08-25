import React from "react";
import { Chunk } from "../world/terrain/types";

export interface GameContextType {
  playerPosition: THREE.Vector3;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  setChunks: (chunks: { [key: string]: { position: number[]; chunk: Chunk } }) => void;
  progress: number;
  setProgress: (progress: number) => void;
  terrain_loaded: boolean;
  setTerrainLoaded: (terrain_loaded: boolean) => void;
  /** Where the active domain wants the player's FEET to spawn (ground-level
   *  position); null = the default sky drop onto the terrain. Set by <Domain
   *  playerSpawn>, read by the Player (which persists across domains). */
  playerSpawn: [number, number, number] | null;
  setPlayerSpawn: (spawn: [number, number, number] | null) => void;
  /** True when LOD1/LOD2 (close, high-detail) terrain chunks are pending build. */
  terrainHighLODPending: React.MutableRefObject<boolean>;
}
