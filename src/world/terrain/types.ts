export interface TerrainProps {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_to_build: Chunk[];
  queued_to_destroy: Set<string>;
}

export interface Chunk {
  /** Canonical `${lod.level}/${gx}/${gz}` key — cached at queue time so the
   *  per-frame passes never rebuild strings from float math. */
  key: string;
  offset: THREE.Vector2;
  plane: THREE.Mesh;
  rebuildIterator: AsyncIterator<any> | null;
  /** The chunk's Rapier heightfield body — built IMPERATIVELY (rapier-side
   *  only, never a React <RigidBody>): r-t-r walks every React-registered
   *  body every frame (getRigidBody + isSleeping wasm calls, and fixed bodies
   *  never report sleeping, so also translation/rotation → compose/decompose
   *  → lerp/slerp), and ~64 terrain bodies were the bulk of that list. Owned
   *  by the chunk; removed in destroyChunk. */
  colliderBody: import("@dimforge/rapier3d-compat").RigidBody | null;
  lod: import("./lodConfig").LODLevel;
}
