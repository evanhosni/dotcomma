import { createWorkerClient } from "../../utils/workers/workerClient";
import { getActiveDomainConfig } from "../domains/utils";
import type { LODLevel } from "./lodConfig";

// Worker client for terrain.worker.ts (heights, blend fields, normals and collider heights per chunk).

/** One chunk's buffers, per main-grid vertex (the skirt is filled on the main thread, chunkGeometry.ts). */
export interface ChunkBuildResult {
  heights: Float32Array;
  /** count × slots, interleaved per vertex (world/terrain/material.ts owns the slot → biome mapping). */
  biomeSdf: Float32Array;
  biomePresence: Float32Array;
  /** count × slots: the riverbed texture's slot distances (VertexResult.riverbedSdf). */
  riverbedSdf: Float32Array;
  slots: number;
  riverBed: Float32Array;
  distRoad: Float32Array;
  distFreeway: Float32Array;
  freewayAlong: Float32Array;
  normals: Float32Array;
  /** Water surface per vertex (NaN = none); null when nothing in the chunk is under water. */
  waterHeights: Float32Array | null;
  /** Rapier column-major heightfield; null unless the LOD has a collider. */
  colliderHeights: Float32Array | null;
}

const terrainClient = createWorkerClient({
  create: () => new Worker(new URL("../../utils/workers/terrain.worker.ts", import.meta.url), { type: "module" }),
  init: () => ({ config: getActiveDomainConfig() }),
  resultType: "CHUNK_BUILT",
});

export const ensureTerrainWorker = terrainClient.ensure;

/** Domain switch: the next request boots a fresh worker from the new commit. */
export const resetTerrainWorker = terrainClient.reset;

/** Visual-only LODs skip flatten pads: a LOD5 chunk spans ~256 pad tiles, and computing them made far
 *  city builds ~9× slower (stalling spawning too). */
export const requestChunkBuild = (lod: LODLevel, centerX: number, centerZ: number): Promise<ChunkBuildResult> =>
  terrainClient.request({
    type: "BUILD_CHUNK",
    segments: lod.segments,
    chunkSize: lod.chunkSize,
    offsetX: centerX,
    offsetZ: centerZ,
    visualOnly: !lod.hasCollider,
    carvesRivers: lod.carvesRivers,
    needCollider: lod.hasCollider,
  });
