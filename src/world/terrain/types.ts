import * as THREE from "three";
import type { PointXZ } from "../../utils/math/types";
import type { SwapChunk } from "./lodSwaps";
export interface TerrainProps {
  group: THREE.Group;
  chunks: Map<string, Chunk>;
  activeChunk: Chunk | null;
  queuedToBuild: Chunk[];
}

/** A terrain chunk; its swap state (built, drawn, fade range) is lodSwaps.ts's `SwapChunk`. */
export interface Chunk extends SwapChunk {
  /** `${lod.level}/${gx}/${gz}`, cached so per-frame passes never rebuild it from float math. */
  key: string;
  /** World-space chunk center. */
  offset: PointXZ;
  plane: THREE.Mesh;
  /** The WATER surface over this chunk (a child of `plane`, so it shows/hides/moves with it);
   *  null for chunks with no lake or river. Same pooled geometry family as the terrain. */
  water: THREE.Mesh | null;
  rebuildIterator: AsyncIterator<any> | null;
  /** Imperative Rapier body, never a React <RigidBody> (see CLAUDE.md). */
  colliderBody: import("@dimforge/rapier3d-compat").RigidBody | null;
  lod: import("./lodConfig").LODLevel;
}
