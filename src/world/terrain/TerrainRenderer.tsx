import { useRapier } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { traceEvent } from "../../utils/spikeTrace";
import { createWorkerClient } from "../../utils/workers/workerClient";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import type { PointXZ } from "../../utils/math/types";
import { getActiveDomainConfig } from "../domains/utils";
import { getMaterial } from "./material";
import { CHUNK_SIZE, LOD5_CHUNK_SIZE, LOD_LEVELS, LODLevel, MAX_RENDER_DISTANCE, SKIRT_DEPTH } from "./lodConfig";
import { Chunk, TerrainProps } from "./types";

const chunksOverlap = (a: Chunk, b: Chunk): boolean => {
  const aHalf = a.lod.chunkSize / 2;
  const bHalf = b.lod.chunkSize / 2;
  const overlapX = a.offset.x + aHalf > b.offset.x - bHalf && a.offset.x - aHalf < b.offset.x + bHalf;
  const overlapZ = a.offset.z + aHalf > b.offset.z - bHalf && a.offset.z - aHalf < b.offset.z + bHalf;
  return overlapX && overlapZ;
};

// ── Coarse spatial index over chunks ────────────────────────────────────────
// Scanning the whole chunk set per overlap query is O(chunks × queue), which
// grows into the hundreds on both sides when the player outruns generation.
// Tile = the largest chunk size, so any chunk spans at most 2×2 tiles.
const INDEX_TILE = LOD5_CHUNK_SIZE;

class ChunkIndex {
  private tiles = new Map<number, Map<number, Chunk[]>>();
  private count = 0;

  clear(): void {
    if (this.count === 0) return;
    this.tiles.clear();
    this.count = 0;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  add(chunk: Chunk): void {
    const half = chunk.lod.chunkSize / 2;
    const tx1 = Math.floor((chunk.offset.x + half) / INDEX_TILE);
    const tz0 = Math.floor((chunk.offset.z - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.z + half) / INDEX_TILE);
    for (let tx = Math.floor((chunk.offset.x - half) / INDEX_TILE); tx <= tx1; tx++) {
      let col = this.tiles.get(tx);
      if (!col) {
        col = new Map();
        this.tiles.set(tx, col);
      }
      for (let tz = tz0; tz <= tz1; tz++) {
        const bucket = col.get(tz);
        if (bucket) bucket.push(chunk);
        else col.set(tz, [chunk]);
      }
    }
    this.count++;
  }

  overlapsAny(chunk: Chunk, exclude?: Chunk): boolean {
    if (this.count === 0) return false;
    const half = chunk.lod.chunkSize / 2;
    const tx1 = Math.floor((chunk.offset.x + half) / INDEX_TILE);
    const tz0 = Math.floor((chunk.offset.z - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.z + half) / INDEX_TILE);
    for (let tx = Math.floor((chunk.offset.x - half) / INDEX_TILE); tx <= tx1; tx++) {
      const col = this.tiles.get(tx);
      if (!col) continue;
      for (let tz = tz0; tz <= tz1; tz++) {
        const bucket = col.get(tz);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (other !== exclude && other !== chunk && chunksOverlap(chunk, other)) return true;
        }
      }
    }
    return false;
  }
}

const pendingIndex = new ChunkIndex();
const pendingSet = new Set<Chunk>();
const unswappableStaleIndex = new ChunkIndex();
const visibleStaleIndex = new ChunkIndex();

const terrain: TerrainProps = {
  group: new THREE.Group(),
  chunks: {},
  activeChunk: null,
  queuedToBuild: [],
  queuedToDestroy: new Set<string>(),
};

let queueDirty = false;

// ── Steady-state gate ────────────────────────────────────────────────────────
// The desired set is recomputed only after DESIRED_MOVE_EPS of camera travel
// and the whole pass is skipped once queues are drained — the quadtree
// descent (~270 leaves, ~800 allocations) otherwise ran every parked frame.
const DESIRED_MOVE_EPS_SQ = 8 * 8;
let cachedDesired: { [key: string]: { position: number[]; lod: LODLevel } } | null = null;
let desiredAtX = Infinity;
let desiredAtZ = Infinity;
let terrainDirty = true;
let lastSortX = Infinity;
let lastSortZ = Infinity;

const swappableKeys = new Set<string>();
const cancelledKeys = new Set<string>();
const pruneKeys: string[] = [];

const geometryPool: Map<number, THREE.BufferGeometry[]> = new Map();

const acquireGeometry = (lod: LODLevel): THREE.BufferGeometry => {
  const pool = geometryPool.get(lod.level);
  if (pool && pool.length > 0) {
    return pool.pop()!;
  }
  return createChunkGeometry(lod.chunkSize, lod.segments);
};

const releaseGeometry = (lod: LODLevel, geom: THREE.BufferGeometry) => {
  // three caches the lazily computed bounds for the geometry's life — a pooled
  // geometry otherwise keeps its FIRST chunk's sphere (edge-of-screen popping).
  geom.boundingSphere = null;
  geom.boundingBox = null;
  let pool = geometryPool.get(lod.level);
  if (!pool) {
    pool = [];
    geometryPool.set(lod.level, pool);
  }
  pool.push(geom);
};

// ── Terrain Worker ──────────────────────────────────────────────────────────
const terrainClient = createWorkerClient({
  create: () => new Worker(new URL("../../utils/workers/terrain.worker.ts", import.meta.url), { type: "module" }),
  init: () => ({ config: getActiveDomainConfig() }),
  resultType: "CHUNK_BUILT",
});
const ensureTerrainWorker = terrainClient.ensure;

/** Domain-switch teardown of the MODULE state that survives a remount. The
 *  geometry pool is kept: pooled geometries are fully rewritten on acquire. */
export const resetTerrainSystem = () => {
  terrainClient.reset();
  for (const key of Object.keys(terrain.chunks)) {
    const { chunk } = terrain.chunks[key];
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    terrain.group.remove(chunk.plane);
    // Bodies already left the persistent physics world in the unmount cleanup.
    chunk.colliderBody = null;
    delete terrain.chunks[key];
  }
  terrain.activeChunk = null;
  terrain.queuedToBuild.length = 0;
  terrain.queuedToDestroy.clear();
  pendingIndex.clear();
  pendingSet.clear();
  unswappableStaleIndex.clear();
  visibleStaleIndex.clear();
  queueDirty = false;
  cachedDesired = null;
  desiredAtX = Infinity;
  desiredAtZ = Infinity;
  terrainDirty = true;
  lastSortX = Infinity;
  lastSortZ = Infinity;
  swappableKeys.clear();
  cancelledKeys.clear();
  pruneKeys.length = 0;
};

const buildChunkInWorker = (
  segments: number,
  chunkSize: number,
  offsetX: number,
  offsetZ: number,
  skipPads: boolean,
  needCollider: boolean,
): Promise<{
  heights: Float32Array;
  biomeIds: Float32Array;
  distBiome: Float32Array;
  distRegion: Float32Array;
  distRoad: Float32Array;
  distFreeway: Float32Array;
  freewayAlong: Float32Array;
  normals: Float32Array;
  colliderHeights: Float32Array | null;
}> => {
  return terrainClient.request({
    type: "BUILD_CHUNK",
    segments,
    chunkSize,
    offsetX,
    offsetZ,
    skipPads,
    needCollider,
  });
};

const lodBySize: { [size: number]: LODLevel } = {};
for (const lod of LOD_LEVELS) {
  lodBySize[lod.chunkSize] = lod;
}

const subdivideThreshold: { [size: number]: number } = {
  [LOD5_CHUNK_SIZE]: LOD_LEVELS[3].maxDistance, // 3360 subdivides at LOD4.maxDist (6720)
  [LOD5_CHUNK_SIZE / 2]: LOD_LEVELS[2].maxDistance, // 1680 subdivides at LOD3.maxDist (3360)
  [LOD5_CHUNK_SIZE / 4]: LOD_LEVELS[1].maxDistance, // 840 subdivides at LOD2.maxDist (1680)
};

const computeDesiredChunks = (playerX: number, playerZ: number) => {
  const desired: { [key: string]: { position: number[]; lod: LODLevel } } = {};

  const visitNode = (ox: number, oz: number, size: number) => {
    const clampedX = Math.max(ox, Math.min(playerX, ox + size));
    const clampedZ = Math.max(oz, Math.min(playerZ, oz + size));
    const dist = Math.sqrt((clampedX - playerX) ** 2 + (clampedZ - playerZ) ** 2);

    if (size > CHUNK_SIZE) {
      const threshold = subdivideThreshold[size];
      if (threshold !== undefined && dist < threshold) {
        const half = size / 2;
        visitNode(ox, oz, half);
        visitNode(ox + half, oz, half);
        visitNode(ox, oz + half, half);
        visitNode(ox + half, oz + half, half);
        return;
      }
    }

    let lod = lodBySize[size];
    if (!lod) {
      lod = LOD_LEVELS[0];
    }

    if (size === CHUNK_SIZE) {
      lod = dist < LOD_LEVELS[0].maxDistance ? LOD_LEVELS[0] : LOD_LEVELS[1];
    }

    const cx = ox + lod.chunkSize / 2;
    const cz = oz + lod.chunkSize / 2;
    const gx = Math.round(cx / lod.chunkSize);
    const gz = Math.round(cz / lod.chunkSize);
    desired[`${lod.level}/${gx}/${gz}`] = {
      position: [cx, cz],
      lod,
    };
  };

  const rootSize = LOD5_CHUNK_SIZE;
  const radius = Math.ceil(MAX_RENDER_DISTANCE / rootSize);
  const rootGX = Math.floor(playerX / rootSize);
  const rootGZ = Math.floor(playerZ / rootSize);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const ox = (rootGX + dx) * rootSize;
      const oz = (rootGZ + dz) * rootSize;

      const clampedX = Math.max(ox, Math.min(playerX, ox + rootSize));
      const clampedZ = Math.max(oz, Math.min(playerZ, oz + rootSize));
      const dist = Math.sqrt((clampedX - playerX) ** 2 + (clampedZ - playerZ) ** 2);
      if (dist > MAX_RENDER_DISTANCE) continue;

      visitNode(ox, oz, rootSize);
    }
  }

  return desired;
};

/** Clockwise loop of main-grid edge vertex indices (4 × segments). */
const perimeterCache = new Map<number, number[]>();
const getPerimeterIndices = (segments: number): number[] => {
  let cached = perimeterCache.get(segments);
  if (cached) return cached;
  const n = segments + 1;
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(i);
  for (let i = 0; i < segments; i++) indices.push(i * n + segments);
  for (let i = segments; i > 0; i--) indices.push(segments * n + i);
  for (let i = segments; i > 0; i--) indices.push(i * n);
  perimeterCache.set(segments, indices);
  return indices;
};

/** Grid + a skirt ring around the perimeter (skirt positions are filled in buildChunk). */
const createChunkGeometry = (chunkSize: number, segments: number): THREE.BufferGeometry => {
  const n = segments + 1;
  const mainVertCount = n * n;
  const perimeterIndices = getPerimeterIndices(segments);
  const perimCount = perimeterIndices.length;
  const totalVerts = mainVertCount + perimCount * 2;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const halfSize = chunkSize / 2;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const idx = iz * n + ix;
      const x = (ix / segments) * chunkSize - halfSize;
      const y = -(iz / segments) * chunkSize + halfSize; // PlaneGeometry Y convention (flipped Z)
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = 0;
      normals[idx * 3 + 2] = 1; // face +Z (will be rotated to +Y)
      uvs[idx * 2] = ix / segments;
      uvs[idx * 2 + 1] = 1 - iz / segments;
    }
  }

  const mainIndexCount = segments * segments * 6;
  const skirtIndexCount = perimCount * 6;
  const indexArray = new Uint32Array(mainIndexCount + skirtIndexCount);
  let ii = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = iz * n + ix + 1;
      const c = (iz + 1) * n + ix + 1;
      const d = (iz + 1) * n + ix;
      indexArray[ii++] = a;
      indexArray[ii++] = d;
      indexArray[ii++] = b;
      indexArray[ii++] = d;
      indexArray[ii++] = c;
      indexArray[ii++] = b;
    }
  }

  const skirtTopStart = mainVertCount;
  const skirtBotStart = mainVertCount + perimCount;
  for (let i = 0; i < perimCount; i++) {
    const srcIdx = perimeterIndices[i];
    positions[(skirtTopStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtTopStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtTopStart + i) * 3 + 2] = 0;
    positions[(skirtBotStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtBotStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtBotStart + i) * 3 + 2] = -SKIRT_DEPTH;
    normals[(skirtTopStart + i) * 3 + 2] = 1;
    normals[(skirtBotStart + i) * 3 + 2] = 1;
    uvs[(skirtTopStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtTopStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
    uvs[(skirtBotStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtBotStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
  }

  for (let i = 0; i < perimCount; i++) {
    const next = (i + 1) % perimCount;
    const t0 = skirtTopStart + i;
    const t1 = skirtTopStart + next;
    const b0 = skirtBotStart + i;
    const b1 = skirtBotStart + next;
    indexArray[ii++] = t0;
    indexArray[ii++] = t1;
    indexArray[ii++] = b0;
    indexArray[ii++] = b0;
    indexArray[ii++] = t1;
    indexArray[ii++] = b1;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indexArray, 1));
  return geom;
};

export const TerrainRenderer = () => {
  const { camera, scene } = useThree();
  const { world, rapier } = useRapier();
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  const { terrainLoaded, setProgress, setTerrainLoaded, terrainHighLODPending } = useGameContext();
  const lastRemainingRef = React.useRef<number>(-1);
  const isUpdatingTerrain = React.useRef(false);

  useEffect(() => {
    scene.add(terrain.group);
    return () => {
      scene.remove(terrain.group);
      // The physics world outlives the domain, so heightfield bodies must leave with this mount.
      for (const key of Object.keys(terrain.chunks)) {
        const { chunk } = terrain.chunks[key];
        if (chunk.colliderBody !== null) {
          world.removeRigidBody(chunk.colliderBody);
          chunk.colliderBody = null;
        }
      }
    };
  }, []);

  const destroyChunk = (chunkKey: string) => {
    const entry = terrain.chunks[chunkKey];
    if (!entry) return;
    const chunk = entry.chunk;
    if (chunk.colliderBody !== null) {
      world.removeRigidBody(chunk.colliderBody); // removes its heightfield too
      chunk.colliderBody = null;
    }
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    terrain.group.remove(chunk.plane);
    delete terrain.chunks[chunkKey];
  };

  useEffect(() => {
    if (!terrainLoaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      remainingChunks === 0 && setTerrainLoaded(true);
    }
  }, [remainingChunks, terrainLoaded]);

  useEffect(() => {
    getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (!terrainMaterial || isUpdatingTerrain.current) return;
    // Synchronous early-out: reaching the same gate inside the async updateTerrain
    // cost a promise chain + microtask drain every parked frame.
    if (!terrainDirty && cachedDesired !== null) {
      const mdx = camera.position.x - desiredAtX;
      const mdz = camera.position.z - desiredAtZ;
      if (mdx * mdx + mdz * mdz <= DESIRED_MOVE_EPS_SQ) return;
    }
    isUpdatingTerrain.current = true;
    updateTerrain(terrainMaterial).finally(() => {
      isUpdatingTerrain.current = false;
    });
  });

  /** Atomic LOD swap: an old chunk is destroyed only once ALL its replacements
   *  are built, and those replacements are shown in the same frame. Must run
   *  even with an empty destroy queue — pass 2 is what makes freshly built
   *  chunks visible at all. */
  const processSwaps = (desiredChunks: { [key: string]: { position: number[]; lod: LODLevel } }) => {
    // Pending (unbuilt, always invisible) chunks are the only thing that can hold an old chunk back.
    pendingIndex.clear();
    pendingSet.clear();
    for (const c of terrain.queuedToBuild) {
      if (c.plane.visible) continue;
      pendingIndex.add(c);
      pendingSet.add(c);
    }

    // Pass 1: old chunks whose replacements are all built
    const swappable = swappableKeys;
    const cancelled = cancelledKeys;
    swappable.clear();
    cancelled.clear();

    for (const oldKey of terrain.queuedToDestroy) {
      const entry = terrain.chunks[oldKey];
      // Gone already, or desired again (player reversed) → cancel destruction
      if (!entry || desiredChunks[oldKey]) {
        cancelled.add(oldKey);
        continue;
      }
      if (!pendingIndex.overlapsAny(entry.chunk)) swappable.add(oldKey);
    }

    // Pass 2: show built chunks unless they overlap a still-visible old chunk
    // whose OTHER replacements aren't ready yet
    unswappableStaleIndex.clear();
    for (const oldKey of terrain.queuedToDestroy) {
      if (swappable.has(oldKey) || cancelled.has(oldKey)) continue;
      const entry = terrain.chunks[oldKey];
      if (entry) unswappableStaleIndex.add(entry.chunk);
    }

    for (const key in terrain.chunks) {
      const chunk = terrain.chunks[key].chunk;
      if (chunk.plane.visible || pendingSet.has(chunk)) continue;
      if (!unswappableStaleIndex.overlapsAny(chunk)) chunk.plane.visible = true;
    }

    // Pass 3
    for (const oldKey of swappable) {
      destroyChunk(oldKey);
      terrain.queuedToDestroy.delete(oldKey);
    }
    for (const k of cancelled) terrain.queuedToDestroy.delete(k);
  };

  const updateTerrain = async (material: THREE.Material) => {
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    // ── 1. Recompute desired chunks only after real movement ─────────────
    const mdx = playerX - desiredAtX;
    const mdz = playerZ - desiredAtZ;
    const moved = cachedDesired === null || mdx * mdx + mdz * mdz > DESIRED_MOVE_EPS_SQ;
    if (!moved && !terrainDirty) return;
    if (moved) {
      cachedDesired = computeDesiredChunks(playerX, playerZ);
      desiredAtX = playerX;
      desiredAtZ = playerZ;
    }
    const desiredChunks = cachedDesired!;

    // ── 2. Prune stale chunks ────────────────────────────────────────────
    // Visible chunks queued for destruction are COVER: an invisible chunk
    // overlapping one can't be dropped yet.
    visibleStaleIndex.clear();
    for (const oldKey of terrain.queuedToDestroy) {
      const oldData = terrain.chunks[oldKey];
      if (oldData && oldData.chunk.plane.visible) visibleStaleIndex.add(oldData.chunk);
    }

    pruneKeys.length = 0;
    for (const chunkKey in terrain.chunks) {
      if (desiredChunks[chunkKey]) continue;
      const chunk = terrain.chunks[chunkKey].chunk;

      if (chunk.plane.visible) {
        if (!terrain.queuedToDestroy.has(chunkKey)) {
          terrain.queuedToDestroy.add(chunkKey);
          visibleStaleIndex.add(chunk);
        }
      } else if (terrain.activeChunk !== chunk && !visibleStaleIndex.overlapsAny(chunk)) {
        pruneKeys.push(chunkKey);
      }
    }
    for (const key of pruneKeys) {
      destroyChunk(key);
    }

    // ── 3. Add new desired chunks ────────────────────────────────────────
    for (const chunkKey in desiredChunks) {
      if (chunkKey in terrain.chunks) continue;

      const { position, lod } = desiredChunks[chunkKey];
      const [cx, cz] = position;
      const offset: PointXZ = { x: cx, z: cz };

      const chunk = queueChunk(chunkKey, offset, lod, material);
      terrain.chunks[chunkKey] = {
        position: [cx, cz],
        chunk: chunk,
      };
    }

    // ── 4. Atomic visibility swaps ───────────────────────────────────────
    processSwaps(desiredChunks);

    // ── 5. Build chunks (time budget) ────────────────────────────────────
    // Wall-clock, not chunk-count: per-chunk cost varies >10× with LOD and
    // terrain (see CLAUDE.md). At least one chunk builds per pass.
    const BUILD_BUDGET_MS = 5;
    const buildDeadline = performance.now() + BUILD_BUDGET_MS;

    let builtThisPass = false;

    // Drop pruned chunks in place; re-sort only when the queue changed or the camera moved.
    {
      const queue = terrain.queuedToBuild;
      let w = 0;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].key in terrain.chunks) queue[w++] = queue[i];
      }
      if (w !== queue.length) {
        queue.length = w;
        queueDirty = true;
      }
    }

    if (terrain.queuedToBuild.length > 0) {
      const sdx = playerX - lastSortX;
      const sdz = playerZ - lastSortZ;
      if (queueDirty || sdx * sdx + sdz * sdz > 64 * 64) {
        queueDirty = false;
        lastSortX = playerX;
        lastSortZ = playerZ;
        terrain.queuedToBuild.sort((a, b) => {
          if (a.lod.level !== b.lod.level) return b.lod.level - a.lod.level;
          const distA = (a.offset.x - playerX) ** 2 + (a.offset.z - playerZ) ** 2;
          const distB = (b.offset.x - playerX) ** 2 + (b.offset.z - playerZ) ** 2;
          return distB - distA;
        });
      }
    }

    while (terrain.queuedToBuild.length > 0) {
      const chunk = terrain.queuedToBuild.pop()!;
      terrain.activeChunk = chunk;
      chunk.rebuildIterator = buildChunk(chunk, material);
      try {
        await chunk.rebuildIterator.next();
        builtThisPass = true;
      } catch (error) {
        console.error("Error updating terrain:", error);
      }
      terrain.activeChunk = null;
      if (performance.now() > buildDeadline) break;
    }

    const hasHighLOD =
      terrain.queuedToBuild.some((c) => c.lod.level <= 2) ||
      (terrain.activeChunk !== null && terrain.activeChunk.lod.level <= 2);
    terrainHighLODPending.current = hasHighLOD;

    // Only the loading bar needs this; after terrainLoaded a re-render per queue change is waste.
    const newRemaining = terrain.queuedToBuild.length;
    if (newRemaining !== lastRemainingRef.current && !terrainLoaded) {
      lastRemainingRef.current = newRemaining;
      if (remainingChunks === null) setTotalChunks(newRemaining);
      setRemainingChunks(newRemaining);
    }

    // Stay "dirty" while anything is still in flight, and for one extra pass
    // after the last build so processSwaps gets to make it visible.
    terrainDirty =
      builtThisPass ||
      terrain.queuedToBuild.length > 0 ||
      terrain.activeChunk !== null ||
      terrain.queuedToDestroy.size > 0;
  };

  const queueChunk = (chunkKey: string, offset: PointXZ, lod: LODLevel, material: THREE.Material) => {
    const plane = new THREE.Mesh(acquireGeometry(lod), material);
    plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
    plane.castShadow = false;
    // receiveShadow left on would recompile every terrain program the day a light casts a shadow.
    plane.receiveShadow = false;
    plane.rotation.x = -Math.PI / 2;
    uploadOnFirstDraw(plane);

    const chunk: Chunk = {
      key: chunkKey,
      offset: { x: offset.x, z: offset.z },
      plane: plane,
      rebuildIterator: null,
      colliderBody: null,
      lod: lod,
    };

    terrain.group.add(plane);
    terrain.queuedToBuild.push(chunk);
    queueDirty = true;

    return chunk;
  };

  const buildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    await ensureTerrainWorker();

    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const segments = chunk.lod.segments;
    const n = segments + 1;
    const mainVertCount = n * n;
    const perimeterIndices = getPerimeterIndices(segments);
    const perimCount = perimeterIndices.length;
    const posArray = pos.array as Float32Array;

    // Visual-only LODs skip flatten pads: a LOD5 chunk spans ~256 pad tiles
    // and computing them exploded far city builds ~9× (stalling spawning too).
    const workerResult = await buildChunkInWorker(
      segments,
      chunk.lod.chunkSize,
      offset.x,
      offset.z,
      !chunk.lod.hasCollider,
      chunk.lod.hasCollider
    );
    const { heights, biomeIds, distBiome, distRegion, distRoad, distFreeway, freewayAlong } = workerResult;
    const traceT0 = performance.now();

    const totalVerts = pos.count;
    const geom = chunk.plane.geometry;
    const ensureAttr = (name: string): Float32Array => {
      const existing = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (existing && existing.count === totalVerts) return existing.array as Float32Array;
      const arr = new Float32Array(totalVerts);
      geom.setAttribute(name, new THREE.BufferAttribute(arr, 1));
      return arr;
    };
    const attrBiomeId = ensureAttr("biomeId");
    const attrDistBiome = ensureAttr("distanceToBiomeBoundaryCenter");
    const attrDistRegion = ensureAttr("distanceToRiverCenter");
    const attrDistRoad = ensureAttr("distanceToRoadCenter");
    const attrDistFreeway = ensureAttr("distanceToFreewayCenter");
    const attrFreewayAlong = ensureAttr("freewayAlong");

    for (let i = 0; i < mainVertCount; i++) {
      posArray[i * 3 + 2] = heights[i];
      attrBiomeId[i] = biomeIds[i];
      attrDistBiome[i] = distBiome[i];
      attrDistRegion[i] = distRegion[i];
      attrDistRoad[i] = distRoad[i];
      attrDistFreeway[i] = distFreeway[i];
      attrFreewayAlong[i] = freewayAlong[i];
    }

    const skirtTopStart = mainVertCount;
    const skirtBotStart = mainVertCount + perimCount;
    for (let i = 0; i < perimCount; i++) {
      const srcIdx = perimeterIndices[i];
      const src3 = srcIdx * 3;
      const sx = posArray[src3];
      const sy = posArray[src3 + 1];
      const sh = posArray[src3 + 2];

      const top3 = (skirtTopStart + i) * 3;
      posArray[top3] = sx;
      posArray[top3 + 1] = sy;
      posArray[top3 + 2] = sh;
      const bot3 = (skirtBotStart + i) * 3;
      posArray[bot3] = sx;
      posArray[bot3 + 1] = sy;
      posArray[bot3 + 2] = sh - SKIRT_DEPTH;

      attrBiomeId[skirtTopStart + i] = attrBiomeId[srcIdx];
      attrBiomeId[skirtBotStart + i] = attrBiomeId[srcIdx];
      attrDistBiome[skirtTopStart + i] = attrDistBiome[srcIdx];
      attrDistBiome[skirtBotStart + i] = attrDistBiome[srcIdx];
      attrDistRegion[skirtTopStart + i] = attrDistRegion[srcIdx];
      attrDistRegion[skirtBotStart + i] = attrDistRegion[srcIdx];
      attrDistRoad[skirtTopStart + i] = attrDistRoad[srcIdx];
      attrDistRoad[skirtBotStart + i] = attrDistRoad[srcIdx];
      attrDistFreeway[skirtTopStart + i] = attrDistFreeway[srcIdx];
      attrDistFreeway[skirtBotStart + i] = attrDistFreeway[srcIdx];
      attrFreewayAlong[skirtTopStart + i] = attrFreewayAlong[srcIdx];
      attrFreewayAlong[skirtBotStart + i] = attrFreewayAlong[srcIdx];
    }

    (geom.getAttribute("biomeId") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToBiomeBoundaryCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToRiverCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToRoadCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToFreewayCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("freewayAlong") as THREE.BufferAttribute).needsUpdate = true;

    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    const normalArray = chunk.plane.geometry.attributes.normal.array as Float32Array;
    normalArray.set(workerResult.normals, 0);

    // Skirt normals copy the edge so the skirt never triggers the triplanar branch.
    for (let i = 0; i < perimCount; i++) {
      const srcIdx = perimeterIndices[i];
      const nx = normalArray[srcIdx * 3];
      const ny = normalArray[srcIdx * 3 + 1];
      const nz = normalArray[srcIdx * 3 + 2];
      const topIdx = (skirtTopStart + i) * 3;
      const botIdx = (skirtBotStart + i) * 3;
      normalArray[topIdx] = nx;
      normalArray[topIdx + 1] = ny;
      normalArray[topIdx + 2] = nz;
      normalArray[botIdx] = nx;
      normalArray[botIdx + 1] = ny;
      normalArray[botIdx + 2] = nz;
    }
    (chunk.plane.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    chunk.plane.position.set(offset.x, 0, offset.z);

    if (chunk.lod.hasCollider && workerResult.colliderHeights) {
      generateColliders(chunk, offset, workerResult.colliderHeights);
    }

    traceEvent(`terrain:finish L${chunk.lod.level}`, performance.now() - traceT0);

    yield;
  };

  /** Heightfield (column-major heights from the worker) straight into the
   *  Rapier world — never a React <RigidBody>, see CLAUDE.md. The desc is
   *  created before the body so a failure can't leave an empty body behind. */
  const generateColliders = (chunk: Chunk, offset: PointXZ, heights: Float32Array) => {
    const segments = chunk.lod.segments;
    const cs = chunk.lod.chunkSize;
    const t0 = performance.now();
    const desc = rapier.ColliderDesc.heightfield(segments, segments, heights, { x: cs, y: 1, z: cs });
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(offset.x, 0, offset.z));
    try {
      world.createCollider(desc, body);
    } catch (e) {
      world.removeRigidBody(body);
      console.error("terrain heightfield collider failed:", e);
      return;
    }
    chunk.colliderBody = body;
    traceEvent("terrain:collider", performance.now() - t0);
  };

  return null;
};
