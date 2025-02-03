export interface TerrainProps {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_chunks: Chunk[];
  chunksToDelete: string[];
}

export interface Chunk {
  offset: THREE.Vector2;
  plane: THREE.Mesh;
  rebuildIterator: AsyncIterator<any> | null;
  collider: TerrainColliderProps | null;
}

export interface TerrainColliderProps {
  chunkKey: string;
  heightfield: number[][];
  position: number[];
  elementSize: number;
}
