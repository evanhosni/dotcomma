import React from "react";
import { Chunk } from "../world/terrain/types";

export interface GameContextType {
  playerPosition: THREE.Vector3;
  setPlayerPosition: (position: THREE.Vector3) => void;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  setChunks: (chunks: { [key: string]: { position: number[]; chunk: Chunk } }) => void;
  progress: number;
  setProgress: (progress: number) => void;
  terrain_loaded: boolean;
  setTerrainLoaded: (terrain_loaded: boolean) => void;
  /** True when LOD1/LOD2 (close, high-detail) terrain chunks are pending build. */
  terrainHighLODPending: React.MutableRefObject<boolean>;
  /** Set by ObjectPool — true when spawn generation is in progress or queued. */
  spawnPending: React.MutableRefObject<boolean>;
}
