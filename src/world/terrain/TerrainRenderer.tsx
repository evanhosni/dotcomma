import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { traceEvent } from "../../utils/spikeTrace";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { getActiveDomainConfig } from "../domains/utils";
import { getMaterial } from "./material";
import { CHUNK_SIZE, LOD5_CHUNK_SIZE, LOD_LEVELS, LODLevel, MAX_RENDER_DISTANCE, SKIRT_DEPTH } from "./lodConfig";
import { Chunk, TerrainColliderProps, TerrainProps } from "./types";

/** Check if two chunks' AABBs overlap (works across different chunk sizes). */
const chunksOverlap = (a: Chunk, b: Chunk): boolean => {
  const aHalf = a.lod.chunkSize / 2;
  const bHalf = b.lod.chunkSize / 2;
  const overlapX = a.offset.x + aHalf > b.offset.x - bHalf && a.offset.x - aHalf < b.offset.x + bHalf;
  const overlapZ = a.offset.y + aHalf > b.offset.y - bHalf && a.offset.y - aHalf < b.offset.y + bHalf;
  return overlapX && overlapZ;
};

// ── Coarse spatial index over chunks ────────────────────────────────────────
// The swap/prune passes all ask the same question every frame: "does any
// chunk in set X overlap chunk C?". Answering it by scanning the whole set is
// O(chunks × queue) — fine when both are small, but a player who outruns
// terrain generation grows BOTH sides into the hundreds (every chunk left
// behind waits in queued_to_destroy until its coarse replacement is built,
// and coarse replacements are the lowest build priority), and the scan alone
// then costs more than a frame. Bucketing by a fixed grid keeps every query
// to the handful of chunks that share the queried chunk's tiles.
//
// Tile = the largest chunk size, so any chunk spans at most 2×2 tiles.
const INDEX_TILE = LOD5_CHUNK_SIZE;

class ChunkIndex {
  /** tileX → tileZ → chunks. Nested maps keep keys numeric (no string
   *  allocation per query, no packing collisions at extreme coordinates). */
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
    const tz0 = Math.floor((chunk.offset.y - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.y + half) / INDEX_TILE);
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

  /** True when any indexed chunk other than `exclude` overlaps `chunk`. */
  overlapsAny(chunk: Chunk, exclude?: Chunk): boolean {
    if (this.count === 0) return false;
    const half = chunk.lod.chunkSize / 2;
    const tx1 = Math.floor((chunk.offset.x + half) / INDEX_TILE);
    const tz0 = Math.floor((chunk.offset.y - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.y + half) / INDEX_TILE);
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

// Reused across frames (cleared + refilled) so the per-frame passes allocate
// nothing.
const pendingIndex = new ChunkIndex(); // chunks still waiting to be built
const pendingSet = new Set<Chunk>(); // same set, for identity tests
const blockerIndex = new ChunkIndex(); // stale chunks that must stay visible
const coverIndex = new ChunkIndex(); // stale VISIBLE chunks acting as cover

const terrain: TerrainProps = {
  group: new THREE.Group(),
  chunks: {},
  active_chunk: null,
  queued_to_build: [],
  queued_to_destroy: new Set<string>(),
};

let queueDirty = false;

// ── Steady-state gate ────────────────────────────────────────────────────────
// The desired chunk set depends only on camera position, so it is recomputed
// only after the camera moves DESIRED_MOVE_EPS units (negligible against the
// 420u base chunk), and the whole update pass is skipped once the queues are
// drained and the last built chunk has been made visible. Without this, the
// full quadtree descent (~270 leaves, ~800 allocations) ran every frame even
// standing still.
const DESIRED_MOVE_EPS_SQ = 8 * 8;
let cachedDesired: { [key: string]: { position: number[]; lod: LODLevel } } | null = null;
let desiredAtX = Infinity;
let desiredAtZ = Infinity;
let terrainDirty = true;
// Camera position at the last build-queue sort (re-sorted when it drifts)
let lastSortX = Infinity;
let lastSortZ = Infinity;

// Reused per-pass collections (cleared, never reallocated)
const swappableKeys = new Set<string>();
const cancelledKeys = new Set<string>();
const pruneKeys: string[] = [];

// Geometry pool keyed by LOD level — recycles BufferGeometry to avoid GC churn
const geometryPool: Map<number, THREE.BufferGeometry[]> = new Map();

const acquireGeometry = (lod: LODLevel): THREE.BufferGeometry => {
  const pool = geometryPool.get(lod.level);
  if (pool && pool.length > 0) {
    return pool.pop()!;
  }
  return createChunkGeometry(lod.chunkSize, lod.segments);
};

const releaseGeometry = (lod: LODLevel, geom: THREE.BufferGeometry) => {
  let pool = geometryPool.get(lod.level);
  if (!pool) {
    pool = [];
    geometryPool.set(lod.level, pool);
  }
  pool.push(geom);
};

// ── Terrain Worker ──────────────────────────────────────────────────────────
let terrainWorker: Worker | null = null;
let terrainWorkerReady = false;
let terrainWorkerInitPromise: Promise<void> | null = null;
let pendingChunkResolve: ((result: any) => void) | null = null;

const ensureTerrainWorker = (): Promise<void> => {
  if (terrainWorkerReady) return Promise.resolve();
  if (terrainWorkerInitPromise) return terrainWorkerInitPromise;

  terrainWorkerInitPromise = new Promise((resolve) => {
    terrainWorker = new Worker(new URL("../../utils/workers/terrain.worker.ts", import.meta.url), { type: "module" });

    terrainWorker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "INIT_DONE") {
        terrainWorkerReady = true;
        terrainWorker!.onmessage = handleTerrainWorkerMessage;
        resolve();
      }
    };

    const config = getActiveDomainConfig();
    terrainWorker.postMessage({ type: "INIT", config });
  });

  return terrainWorkerInitPromise;
};

const handleTerrainWorkerMessage = (e: MessageEvent) => {
  if (e.data.type === "CHUNK_BUILT" && pendingChunkResolve) {
    pendingChunkResolve(e.data);
    pendingChunkResolve = null;
  }
};

/** Domain switch (resetDomainSystems): the chunk registry, queues, indexes, and
 *  the worker are all MODULE state that survives a <TerrainRenderer> remount —
 *  unmount only detaches terrain.group from the scene. Tear it all down so the
 *  next world starts empty and its worker re-inits with the new config.
 *  (The geometry pool is kept: pooled BufferGeometries are a pure function of
 *  LOD size/segments and get fully rewritten on acquire. Colliders die with
 *  the physics world when the canvas remounts.) */
export const resetTerrainSystem = () => {
  terrainWorker?.terminate();
  terrainWorker = null;
  terrainWorkerReady = false;
  terrainWorkerInitPromise = null;
  pendingChunkResolve = null;
  for (const key of Object.keys(terrain.chunks)) {
    const { chunk } = terrain.chunks[key];
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    terrain.group.remove(chunk.plane);
    delete terrain.chunks[key];
  }
  terrain.active_chunk = null;
  terrain.queued_to_build.length = 0;
  terrain.queued_to_destroy.clear();
  pendingIndex.clear();
  pendingSet.clear();
  blockerIndex.clear();
  coverIndex.clear();
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
  return new Promise((resolve) => {
    pendingChunkResolve = resolve;
    // The local vertex grid is a pure function of (chunkSize, segments) — the
    // worker regenerates it from these params instead of the main thread
    // building + transferring two arrays per chunk. Normals and the Rapier
    // column-major collider heights come back precomputed too.
    terrainWorker!.postMessage({
      type: "BUILD_CHUNK",
      id: 0,
      segments,
      chunkSize,
      offsetX,
      offsetZ,
      skipPads,
      needCollider,
    });
  });
};

// LOD lookup by chunk size for quadtree subdivision
const lodBySize: { [size: number]: LODLevel } = {};
for (const lod of LOD_LEVELS) {
  lodBySize[lod.chunkSize] = lod;
}

// Subdivision thresholds: a node of this size subdivides when player is closer than threshold
const subdivideThreshold: { [size: number]: number } = {
  [LOD5_CHUNK_SIZE]: LOD_LEVELS[3].maxDistance, // 3360 subdivides at LOD4.maxDist (10080)
  [LOD5_CHUNK_SIZE / 2]: LOD_LEVELS[2].maxDistance, // 1680 subdivides at LOD3.maxDist (3360)
  [LOD5_CHUNK_SIZE / 4]: LOD_LEVELS[1].maxDistance, // 840 subdivides at LOD2.maxDist (1680)
};

const computeDesiredChunks = (playerX: number, playerZ: number) => {
  const desired: { [key: string]: { position: number[]; lod: LODLevel } } = {};

  const visitNode = (ox: number, oz: number, size: number) => {
    // Distance from player to nearest point on this node's AABB
    const clampedX = Math.max(ox, Math.min(playerX, ox + size));
    const clampedZ = Math.max(oz, Math.min(playerZ, oz + size));
    const dist = Math.sqrt((clampedX - playerX) ** 2 + (clampedZ - playerZ) ** 2);

    // Try to subdivide if this node is larger than the base chunk size
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

    // Leaf node: determine the LOD to use
    let lod = lodBySize[size];
    if (!lod) {
      // Fallback for base chunk size - should not happen normally
      lod = LOD_LEVELS[0];
    }

    // At base chunk size (420), pick LOD1 if close, else LOD2
    if (size === CHUNK_SIZE) {
      lod = dist < LOD_LEVELS[0].maxDistance ? LOD_LEVELS[0] : LOD_LEVELS[1];
    }

    // Store world-space center so mesh covers exactly [ox, ox+size]
    const cx = ox + lod.chunkSize / 2;
    const cz = oz + lod.chunkSize / 2;
    const gx = Math.round(cx / lod.chunkSize);
    const gz = Math.round(cz / lod.chunkSize);
    desired[`${lod.level}/${gx}/${gz}`] = {
      position: [cx, cz],
      lod,
    };
  };

  // Root grid: tiles of LOD5 size covering the render area
  const rootSize = LOD5_CHUNK_SIZE;
  const radius = Math.ceil(MAX_RENDER_DISTANCE / rootSize);
  const rootGX = Math.floor(playerX / rootSize);
  const rootGZ = Math.floor(playerZ / rootSize);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const ox = (rootGX + dx) * rootSize;
      const oz = (rootGZ + dz) * rootSize;

      // Cull root tiles entirely outside render distance
      const clampedX = Math.max(ox, Math.min(playerX, ox + rootSize));
      const clampedZ = Math.max(oz, Math.min(playerZ, oz + rootSize));
      const dist = Math.sqrt((clampedX - playerX) ** 2 + (clampedZ - playerZ) ** 2);
      if (dist > MAX_RENDER_DISTANCE) continue;

      visitNode(ox, oz, rootSize);
    }
  }

  return desired;
};

/** Returns clockwise loop of main-grid edge vertex indices (4×segments total). */
const perimeterCache = new Map<number, number[]>();
const getPerimeterIndices = (segments: number): number[] => {
  let cached = perimeterCache.get(segments);
  if (cached) return cached;
  const n = segments + 1; // vertices per row/col
  const indices: number[] = [];
  // Top edge: left to right
  for (let i = 0; i < segments; i++) indices.push(i);
  // Right edge: top to bottom
  for (let i = 0; i < segments; i++) indices.push(i * n + segments);
  // Bottom edge: right to left
  for (let i = segments; i > 0; i--) indices.push(segments * n + i);
  // Left edge: bottom to top
  for (let i = segments; i > 0; i--) indices.push(i * n);
  perimeterCache.set(segments, indices);
  return indices;
};

/** Creates a BufferGeometry with a standard grid + skirt ring around the perimeter. */
const createChunkGeometry = (chunkSize: number, segments: number): THREE.BufferGeometry => {
  const n = segments + 1;
  const mainVertCount = n * n;
  const perimeterIndices = getPerimeterIndices(segments);
  const perimCount = perimeterIndices.length; // 4 * segments
  const totalVerts = mainVertCount + perimCount * 2; // main + skirt top + skirt bottom

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  // Main grid vertices (same layout as PlaneGeometry)
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

  // Main grid indices
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

  // Skirt top and bottom vertices (placeholders — positions set in BuildChunk)
  const skirtTopStart = mainVertCount;
  const skirtBotStart = mainVertCount + perimCount;
  for (let i = 0; i < perimCount; i++) {
    const srcIdx = perimeterIndices[i];
    // Copy position from main grid as default
    positions[(skirtTopStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtTopStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtTopStart + i) * 3 + 2] = 0;
    positions[(skirtBotStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtBotStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtBotStart + i) * 3 + 2] = -SKIRT_DEPTH;
    // Normals pointing outward (will be recalculated)
    normals[(skirtTopStart + i) * 3 + 2] = 1;
    normals[(skirtBotStart + i) * 3 + 2] = 1;
    // UVs from source
    uvs[(skirtTopStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtTopStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
    uvs[(skirtBotStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtBotStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
  }

  // Skirt indices: 2 triangles per perimeter edge
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

/** The terrain chunk system (LOD quadtree, build loop, colliders).
 *  Mounted by <Domain> once the domain tree has committed — region/biome data
 *  and the worker config come from the active-domain accessors. */
export const TerrainRenderer = () => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  const [colliderVersion, setColliderVersion] = useState(0);
  const { terrain_loaded, setProgress, setTerrainLoaded, terrainHighLODPending } = useGameContext();
  const collidersChanged = React.useRef(false);
  const lastRemainingRef = React.useRef<number>(-1);
  const isUpdatingTerrain = React.useRef(false);

  useEffect(() => {
    scene.add(terrain.group);
    return () => { scene.remove(terrain.group); };
  }, []);

  const destroyChunk = (chunkKey: string) => {
    const entry = terrain.chunks[chunkKey];
    if (!entry) return;
    const chunk = entry.chunk;
    if (chunk.collider !== null) collidersChanged.current = true;
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    terrain.group.remove(chunk.plane);
    delete terrain.chunks[chunkKey];
  };

  useEffect(() => {
    if (!terrain_loaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      remainingChunks === 0 && setTerrainLoaded(true);
    }
  }, [remainingChunks, terrain_loaded]);

  useEffect(() => {
    getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial && !isUpdatingTerrain.current) {
      isUpdatingTerrain.current = true;
      UpdateTerrain(terrainMaterial).finally(() => {
        isUpdatingTerrain.current = false;
      });
    }
  });

  /** Atomic LOD swap: only show new chunks when ALL replacements for an old chunk
   *  are built, then hide+destroy the old chunk in the same frame. */
  const ProcessSwaps = (desiredChunks: { [key: string]: { position: number[]; lod: LODLevel } }) => {
    // NOTE: this must run even with an empty destroy queue — pass 2 is what
    // makes freshly built chunks visible at all (nothing to swap on startup).

    // Collect chunks still pending build (queued or actively building) — they
    // are the ONLY thing that can hold an old chunk back, and they are always
    // invisible (a chunk is shown in pass 2, after it leaves the queue).
    pendingIndex.clear();
    pendingSet.clear();
    for (const c of terrain.queued_to_build) {
      if (c.plane.visible) continue;
      pendingIndex.add(c);
      pendingSet.add(c);
    }
    // (no active-build case: ProcessSwaps runs before the build loop, when
    // terrain.active_chunk is always null)

    // Pass 1: determine which old chunks have ALL their replacements built
    const swappable = swappableKeys;
    const cancelled = cancelledKeys;
    swappable.clear();
    cancelled.clear();

    for (const oldKey of terrain.queued_to_destroy) {
      const entry = terrain.chunks[oldKey];
      // Gone already, or desired again (player reversed) → cancel destruction
      if (!entry || desiredChunks[oldKey]) {
        cancelled.add(oldKey);
        continue;
      }
      if (!pendingIndex.overlapsAny(entry.chunk)) swappable.add(oldKey);
    }

    // Pass 2: show built-but-invisible chunks only if every old chunk they
    // overlap is swappable (prevents showing over a still-visible old chunk
    // whose OTHER replacements aren't ready yet)
    blockerIndex.clear();
    for (const oldKey of terrain.queued_to_destroy) {
      if (swappable.has(oldKey) || cancelled.has(oldKey)) continue;
      const entry = terrain.chunks[oldKey];
      if (entry) blockerIndex.add(entry.chunk);
    }

    for (const key in terrain.chunks) {
      const chunk = terrain.chunks[key].chunk;
      if (chunk.plane.visible || pendingSet.has(chunk)) continue;
      if (!blockerIndex.overlapsAny(chunk)) chunk.plane.visible = true;
    }

    // Pass 3: destroy swappable old chunks + clean processed/cancelled entries
    for (const oldKey of swappable) {
      destroyChunk(oldKey);
      terrain.queued_to_destroy.delete(oldKey);
    }
    for (const k of cancelled) terrain.queued_to_destroy.delete(k);
  };

  const UpdateTerrain = async (material: THREE.Material) => {
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    // ── 1. Recompute desired chunks only after real movement ─────────────
    const mdx = playerX - desiredAtX;
    const mdz = playerZ - desiredAtZ;
    const moved = cachedDesired === null || mdx * mdx + mdz * mdz > DESIRED_MOVE_EPS_SQ;
    // Steady state (queues drained, everything visible, camera parked):
    // nothing below can change anything — skip the whole pass.
    if (!moved && !terrainDirty) return;
    if (moved) {
      cachedDesired = computeDesiredChunks(playerX, playerZ);
      desiredAtX = playerX;
      desiredAtZ = playerZ;
    }
    const desiredChunks = cachedDesired!;

    // (terrain.active_chunk is only ever non-null DURING step 5's build loop
    // below — every pass starts with no build in flight, so there is no
    // "cancel the active build" step; an undesired chunk that finished
    // building is simply pruned on the next pass.)

    // ── 2. Prune stale chunks ────────────────────────────────────────────
    // Visible chunks already queued for destruction act as COVER: an
    // invisible chunk overlapping one of them can't be dropped yet. Indexed
    // by position and kept up to date as the loop queues more, so the check
    // stays O(1)-ish instead of scanning the whole destroy queue per chunk.
    coverIndex.clear();
    for (const oldKey of terrain.queued_to_destroy) {
      const oldData = terrain.chunks[oldKey];
      if (oldData && oldData.chunk.plane.visible) coverIndex.add(oldData.chunk);
    }

    pruneKeys.length = 0;
    for (const chunkKey in terrain.chunks) {
      if (desiredChunks[chunkKey]) continue;
      const chunk = terrain.chunks[chunkKey].chunk;

      if (chunk.plane.visible) {
        // Visible — queue for atomic swap via ProcessSwaps
        if (!terrain.queued_to_destroy.has(chunkKey)) {
          terrain.queued_to_destroy.add(chunkKey);
          coverIndex.add(chunk);
        }
      } else if (terrain.active_chunk !== chunk && !coverIndex.overlapsAny(chunk)) {
        // Invisible, not actively building, and nothing depends on it as
        // cover — safe to remove
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
      const offset = new THREE.Vector2(cx, cz);

      const chunk = QueueChunk(chunkKey, offset, lod, material);
      terrain.chunks[chunkKey] = {
        position: [cx, cz],
        chunk: chunk,
      };
    }

    // ── 4. Atomic visibility swaps ───────────────────────────────────────
    ProcessSwaps(desiredChunks);

    // ── 5. Build chunks (time budget) ────────────────────────────────────
    // Wall-clock budgeted, mirroring the spawn worker: per-chunk cost varies
    // wildly with LOD and terrain (a LOD5 chunk is a 4-vertex roundtrip, a
    // LOD1 city chunk runs the flatten engine), so a vertex/count budget
    // either stalls the frame or drains hundreds of chunks in one pass with a
    // frozen, stale queue order. At least one chunk always builds per pass;
    // between passes the desired set, prune, and swaps all get to run again.
    const BUILD_BUDGET_MS = 5;
    const buildDeadline = performance.now() + BUILD_BUDGET_MS;

    let builtThisPass = false;

    // Drop chunks that have been pruned (in place — no per-frame array), sort
    // by priority only when the queue changed or the camera moved meaningfully
    // since the last sort (catch-up must keep streaming nearest-first)
    {
      const queue = terrain.queued_to_build;
      let w = 0;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].key in terrain.chunks) queue[w++] = queue[i];
      }
      if (w !== queue.length) {
        queue.length = w;
        queueDirty = true;
      }
    }

    if (terrain.queued_to_build.length > 0) {
      const sdx = playerX - lastSortX;
      const sdz = playerZ - lastSortZ;
      if (queueDirty || sdx * sdx + sdz * sdz > 64 * 64) {
        queueDirty = false;
        lastSortX = playerX;
        lastSortZ = playerZ;
        terrain.queued_to_build.sort((a, b) => {
          if (a.lod.level !== b.lod.level) return b.lod.level - a.lod.level;
          const distA = (a.offset.x - playerX) ** 2 + (a.offset.y - playerZ) ** 2;
          const distB = (b.offset.x - playerX) ** 2 + (b.offset.y - playerZ) ** 2;
          return distB - distA;
        });
      }
    }

    // Build until the deadline (last element after sort = highest priority)
    while (terrain.queued_to_build.length > 0) {
      const chunk = terrain.queued_to_build.pop()!;
      terrain.active_chunk = chunk;
      chunk.rebuildIterator = BuildChunk(chunk, material);
      try {
        // BuildChunk yields once, after the chunk is fully built
        await chunk.rebuildIterator.next();
        builtThisPass = true;
      } catch (error) {
        console.error("Error updating terrain:", error);
      }
      terrain.active_chunk = null;
      if (performance.now() > buildDeadline) break;
    }

    // Signal whether high-res (LOD1/2) terrain is still pending
    const hasHighLOD =
      terrain.queued_to_build.some((c) => c.lod.level <= 2) ||
      (terrain.active_chunk !== null && terrain.active_chunk.lod.level <= 2);
    terrainHighLODPending.current = hasHighLOD;

    // The remaining count only matters for the loading progress bar — after
    // terrain_loaded, re-rendering the component (and reconciling the whole
    // collider list) every time the queue length changes is pure waste.
    const newRemaining = terrain.queued_to_build.length;
    if (newRemaining !== lastRemainingRef.current && !terrain_loaded) {
      lastRemainingRef.current = newRemaining;
      if (remainingChunks === null) setTotalChunks(newRemaining);
      setRemainingChunks(newRemaining);
    }

    // Single batched collider re-render per frame
    if (collidersChanged.current) {
      collidersChanged.current = false;
      traceEvent("terrain:collider-commit"); // Rapier heightfield builds land in the following React commit
      setColliderVersion((v) => v + 1);
    }

    // Stay "dirty" while anything is still in flight, and for one extra pass
    // after the last build so ProcessSwaps gets to make it visible.
    terrainDirty =
      builtThisPass ||
      terrain.queued_to_build.length > 0 ||
      terrain.active_chunk !== null ||
      terrain.queued_to_destroy.size > 0;
  };

  const QueueChunk = (chunkKey: string, offset: THREE.Vector2, lod: LODLevel, material: THREE.Material) => {
    const plane = new THREE.Mesh(acquireGeometry(lod), material);
    plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    // Chunks built behind the player otherwise defer their whole buffer
    // upload to the frame the player first turns toward them.
    uploadOnFirstDraw(plane);

    const chunk: Chunk = {
      key: chunkKey,
      offset: new THREE.Vector2(offset.x, offset.y),
      plane: plane,
      rebuildIterator: null,
      collider: null,
      lod: lod,
    };

    terrain.group.add(plane);
    terrain.queued_to_build.push(chunk);
    queueDirty = true;

    return chunk;
  };

  const BuildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    await ensureTerrainWorker();

    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const segments = chunk.lod.segments;
    const n = segments + 1;
    const mainVertCount = n * n;
    const perimeterIndices = getPerimeterIndices(segments);
    const perimCount = perimeterIndices.length;
    const posArray = pos.array as Float32Array;

    // One descriptor message per chunk — the worker generates the local grid,
    // heights, attributes, NORMALS, and (for collider LODs) the column-major
    // Rapier heights, so the main thread only writes buffers.
    // Flatten pads (13–24u features) only matter where they can be SEEN and
    // WALKED ON — collider-bearing LODs. Far visual-only chunks skip them: a
    // LOD5 chunk spans ~256 pad tiles, and computing their tiles exploded far
    // city chunk builds ~9× (which stalled terrain, which stalled spawning).
    const workerResult = await buildChunkInWorker(
      segments,
      chunk.lod.chunkSize,
      offset.x,
      offset.y,
      !chunk.lod.hasCollider,
      chunk.lod.hasCollider
    );
    const { heights, biomeIds, distBiome, distRegion, distRoad, distFreeway, freewayAlong } = workerResult;
    const traceT0 = performance.now();

    // Reuse attribute arrays from pooled geometry when available, else allocate
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

    // Write main grid heights + attributes via direct array access
    // (X/Y positions remain from geometry creation; vertX/vertY were transferred to worker)
    for (let i = 0; i < mainVertCount; i++) {
      posArray[i * 3 + 2] = heights[i];
      attrBiomeId[i] = biomeIds[i];
      attrDistBiome[i] = distBiome[i];
      attrDistRegion[i] = distRegion[i];
      attrDistRoad[i] = distRoad[i];
      attrDistFreeway[i] = distFreeway[i];
      attrFreewayAlong[i] = freewayAlong[i];
    }

    // Update skirt vertices via direct array access
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

    // Mark reused attributes for GPU upload
    (geom.getAttribute("biomeId") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToBiomeBoundaryCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToRiverCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToRoadCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("distanceToFreewayCenter") as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute("freewayAlong") as THREE.BufferAttribute).needsUpdate = true;

    // Apply material and update geometry immediately. Normals come
    // precomputed from the worker (main grid only — computeVertexNormals on
    // the main thread iterated the full index buffer including 768 skirt
    // triangles whose results were immediately overwritten below).
    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    const normalArray = chunk.plane.geometry.attributes.normal.array as Float32Array;
    normalArray.set(workerResult.normals, 0);

    // Copy terrain edge normals to skirt vertices so they don't trigger triplanar
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

    chunk.plane.position.set(offset.x, 0, offset.y);

    if (chunk.lod.hasCollider && workerResult.colliderHeights) {
      GenerateColliders(chunk, offset, workerResult.colliderHeights);
      collidersChanged.current = true;
    }

    traceEvent(`terrain:finish L${chunk.lod.level}`, performance.now() - traceT0);

    yield;
  };

  /** heights arrive COLUMN-MAJOR from the worker (col = X axis = ix, row =
   *  Z axis = iz — the order Rapier's heightfield wants), so no transpose or
   *  allocation happens here. */
  const GenerateColliders = (chunk: Chunk, offset: THREE.Vector2, heights: Float32Array) => {
    const segments = chunk.lod.segments;
    const cs = chunk.lod.chunkSize;

    chunk.collider = {
      chunkKey: chunk.key,
      heights,
      nrows: segments,
      ncols: segments,
      position: offset.toArray(),
      chunkSize: cs,
      // Built ONCE, here — see the note on TerrainColliderProps.args
      args: [segments, segments, heights as unknown as number[], { x: cs, y: 1, z: cs }],
      bodyPosition: [offset.x, 0, offset.y],
    };
  };

  // Rebuilt only when a collider actually changed (colliderVersion) — other
  // state renders (progress, material) must not re-reconcile ~64 collider
  // elements against a 300+-entry chunk map.
  const colliderElements = React.useMemo(() => {
    const els: React.ReactElement[] = [];
    for (const key in terrain.chunks) {
      const collider = terrain.chunks[key].chunk.collider;
      if (collider) els.push(<TerrainCollider key={collider.chunkKey} desc={collider} />);
    }
    return els;
  }, [colliderVersion]);

  return <>{colliderElements}</>;
};

/** Memoized on the (stable) collider descriptor: every collider change bumps
 *  colliderVersion and re-renders this list, and an unmemoized re-render tears
 *  down and rebuilds the Rapier heightfield for EVERY chunk. */
export const TerrainCollider: React.FC<{ desc: TerrainColliderProps }> = React.memo(({ desc }) => {
  return (
    <RigidBody type="fixed" position={desc.bodyPosition} colliders={false}>
      <HeightfieldCollider args={desc.args} />
    </RigidBody>
  );
});
