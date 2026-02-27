import { useHeightfield } from "@react-three/cannon";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { buildDimensionConfig } from "../../workers/buildDimensionConfig";
import { DimensionConfig } from "../../workers/vertexCompute";
import { Dimension } from "../types";
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

const terrain: TerrainProps = {
  group: new THREE.Group(),
  chunks: {},
  active_chunk: null,
  queued_to_build: [],
  queued_to_destroy: [],
};

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

const ensureTerrainWorker = (dimension: Dimension): Promise<void> => {
  if (terrainWorkerReady) return Promise.resolve();
  if (terrainWorkerInitPromise) return terrainWorkerInitPromise;

  terrainWorkerInitPromise = new Promise((resolve) => {
    terrainWorker = new Worker(
      new URL("../../workers/terrain.worker.ts", import.meta.url),
      { type: "module" }
    );

    terrainWorker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "INIT_DONE") {
        terrainWorkerReady = true;
        terrainWorker!.onmessage = handleTerrainWorkerMessage;
        resolve();
      }
    };

    const config = buildDimensionConfig(dimension);
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

const buildChunkInWorker = (
  vertexX: Float32Array,
  vertexY: Float32Array,
  offsetX: number,
  offsetZ: number
): Promise<{
  heights: Float32Array;
  biomeIds: Float32Array;
  distBiome: Float32Array;
  distRegion: Float32Array;
  distRoad: Float32Array;
}> => {
  return new Promise((resolve) => {
    pendingChunkResolve = resolve;
    terrainWorker!.postMessage({
      type: "BUILD_CHUNK",
      id: 0,
      vertexX,
      vertexY,
      offsetX,
      offsetZ,
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
const getPerimeterIndices = (segments: number): number[] => {
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

export const Terrain = ({ dimension }: { dimension: Dimension }) => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  const { terrain_loaded, setProgress, setTerrainLoaded, terrainHighLODPending, spawnPending } = useGameContext();

  scene.add(terrain.group);

  useEffect(() => {
    if (!terrain_loaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      remainingChunks === 0 && setTerrainLoaded(true);
    }
  }, [remainingChunks, terrain_loaded]);

  useEffect(() => {
    dimension.getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }
  });

  /** Atomic LOD swap: only show new chunks when ALL replacements for an old chunk
   *  are built, then hide+destroy the old chunk in the same frame. */
  const ProcessSwaps = (desiredChunks: { [key: string]: { position: number[]; lod: LODLevel } }) => {
    // Mark chunks still pending build (queued or actively building)
    for (let i = 0; i < terrain.queued_to_build.length; i++) {
      (terrain.queued_to_build[i] as any).__pending = true;
    }
    if (terrain.active_chunk) (terrain.active_chunk as any).__pending = true;

    // Pass 1: determine which old chunks have ALL their replacements built
    const swappable: { [key: string]: boolean } = {};
    const cancelled: { [key: string]: boolean } = {};

    for (let i = 0; i < terrain.queued_to_destroy.length; i++) {
      const oldKey = terrain.queued_to_destroy[i];
      if (!terrain.chunks[oldKey]) {
        cancelled[oldKey] = true;
        continue;
      }

      // If the old chunk is desired again (player reversed), cancel destruction
      if (desiredChunks[oldKey]) {
        cancelled[oldKey] = true;
        continue;
      }

      const oldChunk = terrain.chunks[oldKey].chunk;
      let allReady = true;

      for (const otherKey in terrain.chunks) {
        if (otherKey === oldKey) continue;
        const other = terrain.chunks[otherKey].chunk;
        if (!other.plane.visible && chunksOverlap(oldChunk, other)) {
          if ((other as any).__pending) {
            allReady = false;
            break;
          }
        }
      }

      if (allReady) {
        swappable[oldKey] = true;
      }
    }

    // Pass 2: show built-but-invisible chunks only if every old chunk they
    // overlap is swappable (prevents showing over a still-visible old chunk
    // whose OTHER replacements aren't ready yet)
    for (const key in terrain.chunks) {
      const chunk = terrain.chunks[key].chunk;
      if (chunk.plane.visible || (chunk as any).__pending) continue;

      let canShow = true;
      for (let i = 0; i < terrain.queued_to_destroy.length; i++) {
        const oldKey = terrain.queued_to_destroy[i];
        if (terrain.chunks[oldKey] && !swappable[oldKey] && !cancelled[oldKey] &&
            chunksOverlap(chunk, terrain.chunks[oldKey].chunk)) {
          canShow = false;
          break;
        }
      }

      if (canShow) {
        chunk.plane.visible = true;
      }
    }

    // Pass 3: destroy swappable old chunks
    for (const oldKey in swappable) {
      if (terrain.chunks[oldKey]) {
        const oldChunk = terrain.chunks[oldKey].chunk;
        releaseGeometry(oldChunk.lod, oldChunk.plane.geometry);
        terrain.group.remove(oldChunk.plane);
        delete terrain.chunks[oldKey];
      }
    }

    // Clean processed/cancelled entries from the destroy queue
    terrain.queued_to_destroy = terrain.queued_to_destroy.filter(
      (k) => !swappable[k] && !cancelled[k]
    );

    // Clean up __pending markers
    for (let i = 0; i < terrain.queued_to_build.length; i++) {
      delete (terrain.queued_to_build[i] as any).__pending;
    }
    if (terrain.active_chunk) delete (terrain.active_chunk as any).__pending;
  };

  const UpdateTerrain = async (material: THREE.Material) => {
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    // ── 1. Recompute desired chunks every frame ──────────────────────────
    const desiredChunks = computeDesiredChunks(playerX, playerZ);

    // ── 2. Cancel active build if no longer desired ──────────────────────
    if (terrain.active_chunk) {
      const ac = terrain.active_chunk;
      const gridX = Math.round(ac.offset.x / ac.lod.chunkSize);
      const gridZ = Math.round(ac.offset.y / ac.lod.chunkSize);
      const acKey = `${ac.lod.level}/${gridX}/${gridZ}`;
      if (!desiredChunks[acKey]) {
        releaseGeometry(ac.lod, ac.plane.geometry);
        terrain.group.remove(ac.plane);
        delete terrain.chunks[acKey];
        terrain.active_chunk = null;
      }
    }

    // ── 3. Prune stale chunks ────────────────────────────────────────────
    for (const chunkKey in terrain.chunks) {
      if (desiredChunks[chunkKey]) continue;
      const chunk = terrain.chunks[chunkKey].chunk;

      if (chunk.plane.visible) {
        // Visible — queue for atomic swap via ProcessSwaps
        if (terrain.queued_to_destroy.indexOf(chunkKey) === -1) {
          terrain.queued_to_destroy.push(chunkKey);
        }
      } else if (terrain.active_chunk !== chunk) {
        // Invisible and not actively building — safe to remove UNLESS
        // it overlaps a visible chunk queued for destruction (that chunk
        // still needs this as cover until a new replacement is ready)
        let neededAsCover = false;
        for (let i = 0; i < terrain.queued_to_destroy.length; i++) {
          const oldKey = terrain.queued_to_destroy[i];
          const oldData = terrain.chunks[oldKey];
          if (oldData && oldData.chunk.plane.visible && chunksOverlap(chunk, oldData.chunk)) {
            neededAsCover = true;
            break;
          }
        }
        if (!neededAsCover) {
          releaseGeometry(chunk.lod, chunk.plane.geometry);
          terrain.group.remove(chunk.plane);
          delete terrain.chunks[chunkKey];
        }
      }
    }

    // ── 4. Add new desired chunks ────────────────────────────────────────
    for (const chunkKey in desiredChunks) {
      if (chunkKey in terrain.chunks) continue;

      const { position, lod } = desiredChunks[chunkKey];
      const [cx, cz] = position;
      const offset = new THREE.Vector2(cx, cz);

      const chunk = QueueChunk(offset, lod, material);
      terrain.chunks[chunkKey] = {
        position: [cx, cz],
        chunk: chunk,
      };
    }

    // ── 5. Atomic visibility swaps ───────────────────────────────────────
    ProcessSwaps(desiredChunks);

    // ── 6. Build chunks (vertex budget) ─────────────────────────────────
    // Priority order: LOD1/2 (high-res) → yield to objects → LOD3-5 (low-res)
    const MAX_VERTS_PER_FRAME = 2500;
    let budget = MAX_VERTS_PER_FRAME;

    // Continue any active build first
    if (terrain.active_chunk) {
      const currentChunk = terrain.active_chunk;
      try {
        const iteratorResult = await terrain.active_chunk.rebuildIterator!.next();
        if (iteratorResult.done) {
          if (terrain.active_chunk === currentChunk) {
            terrain.active_chunk = null;
          }
        } else {
          budget = 0; // active build still in progress, don't start new ones
        }
      } catch (error) {
        console.error("Error updating terrain:", error);
        if (terrain.active_chunk === currentChunk) {
          terrain.active_chunk = null;
        }
      }
    }

    // Start new chunks within vertex budget
    while (budget > 0 && !terrain.active_chunk && terrain.queued_to_build.length > 0) {
      // Filter out chunks that have been pruned, sort by priority
      terrain.queued_to_build = terrain.queued_to_build.filter((chunk) => {
        const gridX = Math.round(chunk.offset.x / chunk.lod.chunkSize);
        const gridZ = Math.round(chunk.offset.y / chunk.lod.chunkSize);
        const key = `${chunk.lod.level}/${gridX}/${gridZ}`;
        return key in terrain.chunks;
      });

      terrain.queued_to_build.sort((a, b) => {
        if (a.lod.level !== b.lod.level) return b.lod.level - a.lod.level;
        const distA = (a.offset.x - playerX) ** 2 + (a.offset.y - playerZ) ** 2;
        const distB = (b.offset.x - playerX) ** 2 + (b.offset.y - playerZ) ** 2;
        return distB - distA;
      });

      // Peek at the next chunk (last element after sort = highest priority)
      const nextChunk = terrain.queued_to_build[terrain.queued_to_build.length - 1];
      if (!nextChunk) break;

      // If the next chunk is low-LOD (3-5) and objects are waiting to spawn,
      // defer it — let ObjectPool have this frame instead
      if (nextChunk.lod.level >= 3 && spawnPending.current) break;

      const chunk = terrain.queued_to_build.pop()!;

      const vertCount = (chunk.lod.segments + 1) ** 2;
      budget -= vertCount;

      terrain.active_chunk = chunk;
      chunk.rebuildIterator = BuildChunk(chunk, material);

      try {
        const iteratorResult = await chunk.rebuildIterator.next();
        if (iteratorResult.done) {
          terrain.active_chunk = null;
        } else {
          // Generator yielded — chunk build complete
          terrain.active_chunk = null;
        }
      } catch (error) {
        console.error("Error updating terrain:", error);
        terrain.active_chunk = null;
      }
    }

    // Signal whether high-res (LOD1/2) terrain is still pending
    const hasHighLOD = terrain.queued_to_build.some((c) => c.lod.level <= 2)
      || (terrain.active_chunk !== null && terrain.active_chunk.lod.level <= 2);
    terrainHighLODPending.current = hasHighLOD;

    if (remainingChunks === null) setTotalChunks(terrain.queued_to_build.length);
    setRemainingChunks(terrain.queued_to_build.length);
  };

  const QueueChunk = (offset: THREE.Vector2, lod: LODLevel, material: THREE.Material) => {
    const plane = new THREE.Mesh(acquireGeometry(lod), material);
    plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    const chunk: Chunk = {
      offset: new THREE.Vector2(offset.x, offset.y),
      plane: plane,
      rebuildIterator: null,
      collider: null,
      lod: lod,
    };

    terrain.group.add(plane);
    terrain.queued_to_build.push(chunk);

    return chunk;
  };

  const BuildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    await ensureTerrainWorker(dimension);

    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const segments = chunk.lod.segments;
    const n = segments + 1;
    const mainVertCount = n * n;
    const perimeterIndices = getPerimeterIndices(segments);
    const perimCount = perimeterIndices.length;
    const posArray = pos.array as Float32Array;

    // Read vertex positions directly from buffer (avoid Vector3 allocation per vertex)
    const vertX = new Float32Array(mainVertCount);
    const vertY = new Float32Array(mainVertCount);
    for (let i = 0; i < mainVertCount; i++) {
      vertX[i] = posArray[i * 3];
      vertY[i] = posArray[i * 3 + 1];
    }

    // Send all vertex positions to the terrain worker in a single message
    const workerResult = await buildChunkInWorker(vertX, vertY, offset.x, offset.y);
    const { heights, biomeIds, distBiome, distRegion, distRoad } = workerResult;

    // Build attribute buffers (only the 4 attributes the shader actually uses)
    const totalVerts = pos.count;
    const attrBiomeId = new Float32Array(totalVerts);
    const attrDistBiome = new Float32Array(totalVerts);
    const attrDistRegion = new Float32Array(totalVerts);
    const attrDistRoad = new Float32Array(totalVerts);

    for (let i = 0; i < mainVertCount; i++) {
      pos.setXYZ(i, vertX[i], vertY[i], heights[i]);
      attrBiomeId[i] = biomeIds[i];
      attrDistBiome[i] = distBiome[i];
      attrDistRegion[i] = distRegion[i];
      attrDistRoad[i] = distRoad[i];
    }

    // Update skirt vertices: copy from corresponding main edge vertices
    const skirtTopStart = mainVertCount;
    const skirtBotStart = mainVertCount + perimCount;
    for (let i = 0; i < perimCount; i++) {
      const srcIdx = perimeterIndices[i];
      const sx = pos.getX(srcIdx);
      const sy = pos.getY(srcIdx);
      const sh = pos.getZ(srcIdx);

      pos.setXYZ(skirtTopStart + i, sx, sy, sh);
      pos.setXYZ(skirtBotStart + i, sx, sy, sh - SKIRT_DEPTH);

      attrBiomeId[skirtTopStart + i] = attrBiomeId[srcIdx];
      attrBiomeId[skirtBotStart + i] = attrBiomeId[srcIdx];
      attrDistBiome[skirtTopStart + i] = attrDistBiome[srcIdx];
      attrDistBiome[skirtBotStart + i] = attrDistBiome[srcIdx];
      attrDistRegion[skirtTopStart + i] = attrDistRegion[srcIdx];
      attrDistRegion[skirtBotStart + i] = attrDistRegion[srcIdx];
      attrDistRoad[skirtTopStart + i] = attrDistRoad[srcIdx];
      attrDistRoad[skirtBotStart + i] = attrDistRoad[srcIdx];
    }

    chunk.plane.geometry.setAttribute("biomeId", new THREE.BufferAttribute(attrBiomeId, 1));
    chunk.plane.geometry.setAttribute("distanceToBiomeBoundaryCenter", new THREE.BufferAttribute(attrDistBiome, 1));
    chunk.plane.geometry.setAttribute("distanceToRegionBoundaryCenter", new THREE.BufferAttribute(attrDistRegion, 1));
    chunk.plane.geometry.setAttribute("distanceToRoadCenter", new THREE.BufferAttribute(attrDistRoad, 1));

    // Apply material and update geometry immediately
    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);

    if (chunk.lod.hasCollider) {
      GenerateColliders(chunk, offset);
    }

    yield;
  };

  const GenerateColliders = (chunk: Chunk, offset: THREE.Vector2) => {
    const segments = chunk.lod.segments;
    const cs = chunk.lod.chunkSize;
    const linearArray = chunk.plane.geometry.attributes.position.array;
    const n = segments + 1;
    const mainVertCount = n * n;
    const heightfield = Array.from({ length: n }, () => Array(n).fill(0));

    // Only iterate main grid vertices, not skirt vertices
    for (let i = 0; i < mainVertCount * 3; i += 3) {
      const x = linearArray[i];
      const z = linearArray[i + 1];
      const height = linearArray[i + 2];

      const xIndex = Math.round((x - -(cs / 2)) / (cs / segments));
      const zIndex = Math.round((z - -(cs / 2)) / (cs / segments));

      const transformedXIndex = segments - xIndex;

      if (zIndex >= 0 && zIndex < n && transformedXIndex >= 0 && transformedXIndex < n) {
        heightfield[zIndex][transformedXIndex] = height;
      }
    }

    const chunkKey = `${offset.x / cs}/${offset.y / cs}`;
    chunk.collider = {
      chunkKey: chunkKey,
      heightfield,
      position: offset.toArray(),
      elementSize: cs / segments,
      chunkSize: cs,
    };
  };

  return (
    <>
      {Object.values(terrain.chunks).map(({ chunk }) => {
        if (chunk.collider) {
          return <TerrainCollider key={chunk.collider.chunkKey} {...chunk.collider} />;
        }
        return null;
      })}
    </>
  );
};

export const TerrainCollider: React.FC<TerrainColliderProps> = ({ heightfield, position, elementSize, chunkSize }) => {
  const [ref] = useHeightfield(() => ({
    args: [heightfield, { elementSize }],
    position: [position[0], 0, position[1]],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
  }));

  return <mesh ref={ref as any} />;
};
