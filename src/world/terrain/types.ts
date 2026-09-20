import * as THREE from "three";
import type { PointXZ } from "../../utils/math/types";
export interface TerrainProps {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  activeChunk: Chunk | null;
  queuedToBuild: Chunk[];
  queuedToDestroy: Set<string>;
}

export interface Chunk {
  /** `${lod.level}/${gx}/${gz}`, cached so per-frame passes never rebuild it from float math. */
  key: string;
  /** World-space chunk center. */
  offset: PointXZ;
  plane: THREE.Mesh;
  rebuildIterator: AsyncIterator<any> | null;
  /** Imperative Rapier body, never a React <RigidBody> (see CLAUDE.md). */
  colliderBody: import("@dimforge/rapier3d-compat").RigidBody | null;
  lod: import("./lodConfig").LODLevel;
}
