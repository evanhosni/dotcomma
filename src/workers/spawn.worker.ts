/**
 * Spawn point generation worker.
 *
 * Runs the density-based deterministic spawn algorithm off the main thread.
 * Maintains its own spatial hash and chunk cache. Uses the inlined vertex
 * pipeline to resolve biome/height data for each candidate point.
 *
 * Messages:
 *   IN:  { type: "INIT", config: DimensionConfig, maxFootprint: number }
 *   IN:  { type: "GENERATE_SPAWNS", id: number, chunkKeys: string[], descriptors: SerializedDescriptor[] }
 *   IN:  { type: "CLEANUP", playerX: number, playerZ: number, cleanupRadius: number }
 *   IN:  { type: "UPDATE_FOOTPRINT", maxFootprint: number }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "SPAWNS_RESULT", id: number, points: SpawnPoint[] }
 */

import { DimensionConfig, initCompute, computeVertexData, seedRand } from "./vertexCompute";

const SPAWN_CHUNK_SIZE = 250;

// ── Inline types (avoid importing from types.ts which depends on React) ──

interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}

interface SerializedDescriptor {
  id: string;
  footprint: number;
  density: number;
  clustering: number;
  renderDistance: number;
  priority?: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  spacingOverrides?: Record<string, number>;
}

// ── Inline Spatial Hash ──

class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  private cells = new Map<string, SpawnPoint[]>();

  constructor(maxFootprint: number) {
    this.cellSize = Math.max(maxFootprint * 2.5, 1);
    this.invCellSize = 1 / this.cellSize;
  }

  private key(cx: number, cz: number): string {
    return `${cx}_${cz}`;
  }

  insert(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    const k = this.key(cx, cz);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(point);
  }

  isTooClose(
    x: number,
    z: number,
    minDist: number,
    spacingOverrides?: Record<string, number>
  ): boolean {
    const minDistSq = minDist * minDist;
    const searchRadius = Math.max(
      minDist,
      spacingOverrides ? Math.max(...Object.values(spacingOverrides)) : 0
    );
    const cellSpan = Math.ceil(searchRadius * this.invCellSize);
    const cx = Math.floor(x * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);

    for (let dx = -cellSpan; dx <= cellSpan; dx++) {
      for (let dz = -cellSpan; dz <= cellSpan; dz++) {
        const bucket = this.cells.get(this.key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const p = bucket[i];
          const ddx = x - p.x;
          const ddz = z - p.z;
          const distSq = ddx * ddx + ddz * ddz;

          const overrideDist = spacingOverrides?.[p.descriptorId];
          if (overrideDist !== undefined) {
            if (distSq < overrideDist * overrideDist) return true;
          } else if (distSq < minDistSq) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

// ── Worker State ──

let initialized = false;
let spatialHash: SpatialHash | null = null;
const chunkCache = new Map<string, SpawnPoint[]>();

// ── Spawn Generation ──

const generateForChunk = (
  chunkKey: string,
  descriptors: SerializedDescriptor[]
): SpawnPoint[] => {
  if (chunkCache.has(chunkKey)) {
    const cached = chunkCache.get(chunkKey)!;
    // Re-insert into spatial hash in case cells were recreated
    for (const p of cached) spatialHash!.insert(p);
    return cached;
  }

  const [cx, cz] = chunkKey.split("_").map(Number);
  const chunkMinX = cx * SPAWN_CHUNK_SIZE;
  const chunkMinZ = cz * SPAWN_CHUNK_SIZE;

  // Sort by priority: lowest first (rarest objects placed first)
  const sorted = [...descriptors].sort(
    (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
  );

  const chunkPoints: SpawnPoint[] = [];

  for (const desc of sorted) {
    if (desc.density <= 0) continue;

    const cellSize = Math.sqrt(1_000_000 / desc.density);
    const startCellX = Math.floor(chunkMinX / cellSize);
    const endCellX = Math.floor((chunkMinX + SPAWN_CHUNK_SIZE) / cellSize);
    const startCellZ = Math.floor(chunkMinZ / cellSize);
    const endCellZ = Math.floor((chunkMinZ + SPAWN_CHUNK_SIZE) / cellSize);

    for (let gx = startCellX; gx <= endCellX; gx++) {
      for (let gz = startCellZ; gz <= endCellZ; gz++) {
        const seed = `${desc.id}_${gx}_${gz}`;
        const rand = seedRand(seed);

        // Clustering gate
        if (desc.clustering > 0) {
          const clusterSeed = `cluster_${desc.id}_${gx}_${gz}`;
          const clusterRand = seedRand(clusterSeed);
          if (clusterRand < desc.clustering * 0.7) continue;
        }

        const jitterX = seedRand(seed + "_x");
        const jitterZ = seedRand(seed + "_z");

        const x = gx * cellSize + jitterX * cellSize;
        const z = gz * cellSize + jitterZ * cellSize;

        // Only place within this chunk
        if (
          x < chunkMinX ||
          x >= chunkMinX + SPAWN_CHUNK_SIZE ||
          z < chunkMinZ ||
          z >= chunkMinZ + SPAWN_CHUNK_SIZE
        ) {
          continue;
        }

        const probability = (desc.density * cellSize * cellSize) / 1_000_000;
        if (rand > probability) continue;

        // Get vertex data from inlined compute pipeline
        const vd = computeVertexData(x, z);

        // Biome restriction
        if (desc.biomeIds && desc.biomeIds.length > 0) {
          if (!desc.biomeIds.includes(vd.biomeId)) continue;
        }

        // Height restriction
        if (desc.heightRange) {
          if (vd.height < desc.heightRange[0] || vd.height > desc.heightRange[1])
            continue;
        }

        // Spacing check via spatial hash
        if (
          spatialHash!.isTooClose(
            x,
            z,
            desc.footprint,
            desc.spacingOverrides
          )
        ) {
          continue;
        }

        const point: SpawnPoint = {
          x,
          z,
          height: vd.height,
          biomeId: vd.biomeId,
          descriptorId: desc.id,
        };

        spatialHash!.insert(point);
        chunkPoints.push(point);
      }
    }
  }

  chunkCache.set(chunkKey, chunkPoints);
  return chunkPoints;
};

// ── Message Handler ──

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DimensionConfig);
    spatialHash = new SpatialHash(e.data.maxFootprint);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "GENERATE_SPAWNS") {
    if (!initialized) {
      (self as any).postMessage({ type: "SPAWNS_RESULT", id: e.data.id, points: [] });
      return;
    }

    const { id, chunkKeys, descriptors } = e.data;
    const allPoints: SpawnPoint[] = [];

    for (const key of chunkKeys) {
      const points = generateForChunk(key, descriptors);
      allPoints.push(...points);
    }

    (self as any).postMessage({ type: "SPAWNS_RESULT", id, points: allPoints });
    return;
  }

  if (type === "CLEANUP") {
    const { playerX, playerZ, cleanupRadius } = e.data;
    const cleanupRadiusSq = cleanupRadius * cleanupRadius;

    for (const key of Array.from(chunkCache.keys())) {
      const [cx, cz] = key.split("_").map(Number);
      const chunkCenterX = (cx + 0.5) * SPAWN_CHUNK_SIZE;
      const chunkCenterZ = (cz + 0.5) * SPAWN_CHUNK_SIZE;
      const distSq =
        (playerX - chunkCenterX) ** 2 + (playerZ - chunkCenterZ) ** 2;

      if (distSq > cleanupRadiusSq) {
        chunkCache.delete(key);
      }
    }
    return;
  }

  if (type === "UPDATE_FOOTPRINT") {
    spatialHash = new SpatialHash(e.data.maxFootprint);
    return;
  }
};
