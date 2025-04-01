import { Chunk } from "../world/terrain/types";

export interface GameContextType {
  playerPosition: THREE.Vector3;
  setPlayerPosition: (position: THREE.Vector3) => void;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  setChunks: (chunks: { [key: string]: { position: number[]; chunk: Chunk } }) => void;
}
