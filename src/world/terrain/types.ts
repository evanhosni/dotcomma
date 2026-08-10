export interface TerrainProps {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_to_build: Chunk[];
  queued_to_destroy: Set<string>;
}

export interface Chunk {
  offset: THREE.Vector2;
  plane: THREE.Mesh;
  rebuildIterator: AsyncIterator<any> | null;
  collider: TerrainColliderProps | null;
  lod: import("./lodConfig").LODLevel;
}

export interface TerrainColliderProps {
  chunkKey: string;
  heights: Float32Array;
  nrows: number;
  ncols: number;
  position: number[];
  chunkSize: number;
  /** STABLE references, built once when the collider is generated.
   *  <HeightfieldCollider> feeds its `args` (spread elementwise) into the
   *  dependency list that owns the Rapier shape — a fresh array/scale object
   *  per render makes it REMOVE and REBUILD the heightfield every time the
   *  parent re-renders. With every collider chunk re-rendering on each
   *  collider change, that was tens of full heightfield rebuilds per built
   *  chunk. Keep these identity-stable and the shape is created exactly once. */
  args: [number, number, number[], { x: number; y: number; z: number }];
  bodyPosition: [number, number, number];
}
