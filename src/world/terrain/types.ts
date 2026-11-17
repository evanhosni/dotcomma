import type Rapier from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { PointXZ } from "../../utils/math/types";
import type { LODLevel } from "./lod/types";
import type { SwapChunk } from "./lod-swaps/types";
import type { ChunkBuildResult } from "./worker";

/** What a pooled grid is drawn as. Each role has its own pools: a grid keeps every attribute it was ever
 *  given (and its GPU buffer), so one shared family left every water sheet holding a terrain chunk's ~30
 *  stale floats a vertex, and every terrain grid that had been water the sheet's 10. */
export type GridRole = "terrain" | "water";

/** TerrainRenderer's module state: every chunk it holds, under one scene group. */
export interface TerrainState {
  group: THREE.Group;
  chunks: Map<string, Chunk>;
  /** The chunk being finished by the update pass (kept out of the prune). */
  activeChunk: Chunk | null;
  queuedToBuild: Chunk[];
}

/** A terrain chunk; its swap state (built, drawn, fade range) is world/terrain/lod-swaps/LodSwapper.ts's `SwapChunk`. */
export interface Chunk extends SwapChunk {
  /** `${lod.level}/${gx}/${gz}`, cached so per-frame passes never rebuild it from float math. */
  key: string;
  /** World-space chunk center. */
  offset: PointXZ;
  plane: THREE.Mesh;
  /** The WATER surface over this chunk (a child of `plane`, so it shows/hides/moves with it);
   *  null for chunks with no lake or river. Same pooled geometry family as the terrain. */
  water: THREE.Mesh | null;
  /** Its worker build, requested ahead of its turn (world/terrain/build-requests/index.ts); null until then. */
  request: Promise<ChunkBuildResult> | null;
  /** Imperative Rapier body, never a React <RigidBody> (see CLAUDE.md). */
  colliderBody: Rapier.RigidBody | null;
  lod: LODLevel;
}
