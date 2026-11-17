import * as THREE from "three";
import { CHUNK_SIZE } from "./lod/constants";
import { lod1KeyAt } from "./lod";
import { LodSwapper } from "./lod-swaps/LodSwapper";
import { Chunk, TerrainState } from "./types";

export const terrain: TerrainState = {
  group: new THREE.Group(),
  chunks: new Map(),
  activeChunk: null,
  queuedToBuild: [],
};

/** Chunk-set bookkeeping: stale chunks, the LOD cross-fades (world/terrain/lod-swaps/LodSwapper.ts). */
export const swapper = new LodSwapper<Chunk>();

/**
 * The LOD1 swap's own progress under a point: the least over the LOD1 chunks within `radius` of it —
 * 1 settled, a fade's progress mid-swap, 0 while any such chunk is missing or undrawn. What a cave
 * entrance fades in by (objects/underground), so it never shows before its ground is LOD1.
 */
export const lod1ShareAt = (x: number, z: number, radius: number): number => {
  let share = 1;
  // The centre and the four corners of the square, each chunk once: it runs every frame per entrance,
  // so the duplicates are found by their grid cell, with no set.
  let n = 0;
  for (let corner = 0; corner < 5; corner++) {
    const px = corner === 4 ? x : corner & 1 ? x + radius : x - radius;
    const pz = corner === 4 ? z : corner & 2 ? z + radius : z - radius;
    const gx = Math.floor(px / CHUNK_SIZE);
    const gz = Math.floor(pz / CHUNK_SIZE);
    let seen = false;
    for (let i = 0; i < n && !seen; i++) seen = _lod1Gx[i] === gx && _lod1Gz[i] === gz;
    if (seen) continue;
    _lod1Gx[n] = gx;
    _lod1Gz[n] = gz;
    n++;
    const chunk = terrain.chunks.get(lod1KeyAt(px, pz));
    if (!chunk || !chunk.drawn) return 0;
    const t = chunk.transition;
    if (t === null) continue;
    const s = t.news.includes(chunk) ? t.p : 1 - t.p;
    if (s < share) share = s;
  }
  return share;
};
const _lod1Gx = new Int32Array(5);
const _lod1Gz = new Int32Array(5);
