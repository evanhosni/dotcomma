/**
 * Spawn point worker: deterministic density placement with its own spatial hash
 * and chunk cache.
 *
 *   IN:  { type: "INIT", config: DomainConfig, maxFootprint: number }
 *   IN:  { type: "GENERATE_SPAWNS", id: number, chunkKeys: string[], descriptors: SerializedDescriptor[] }
 *   IN:  { type: "CLEANUP", playerX: number, playerZ: number, cleanupRadius: number }
 *   IN:  { type: "UPDATE_FOOTPRINT", maxFootprint: number }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "SPAWNS_RESULT", id: number, points: SpawnPoint[] }
 */

import { FlattenPoint, DomainConfig, initCompute, computeVertexData, getFlattenPoints } from "./vertexCompute";
import { densityCellRange, densityCellSize, densityProbability, passesPlacementFilters, rollDensityCell } from "./densityPlacement";
// Type-only: keeps the React-dependent module out of the worker bundle.
import type { SerializedActorDescriptor as SerializedDescriptor, SpawnPoint } from "../../objects/actors/spawning/types";

const SPAWN_CHUNK_SIZE = 250;

class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  // Nested numeric maps (cx → cz → bucket): a string key was built per candidate
  // × 9 neighbor cells. Buckets keep insertion order; isTooClose scans dx-then-dz.
  private cells = new Map<number, Map<number, SpawnPoint[]>>();

  constructor(maxFootprint: number) {
    this.cellSize = Math.max(maxFootprint * 2.5, 1);
    this.invCellSize = 1 / this.cellSize;
  }

  insert(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    let row = this.cells.get(cx);
    if (!row) {
      row = new Map();
      this.cells.set(cx, row);
    }
    let bucket = row.get(cz);
    if (!bucket) {
      bucket = [];
      row.set(cz, bucket);
    }
    bucket.push(point);
  }

  /** Remove by identity (points in the hash are the same refs held by chunkCache). */
  remove(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    const row = this.cells.get(cx);
    if (!row) return;
    const bucket = row.get(cz);
    if (!bucket) return;
    const i = bucket.indexOf(point);
    if (i !== -1) bucket.splice(i, 1);
    if (bucket.length === 0) {
      row.delete(cz);
      if (row.size === 0) this.cells.delete(cx);
    }
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
      const row = this.cells.get(cx + dx);
      if (!row) continue;
      for (let dz = -cellSpan; dz <= cellSpan; dz++) {
        const bucket = row.get(cz + dz);
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

let initialized = false;
let spatialHash: SpatialHash | null = null;

/** Carries its own center and hash membership: CLEANUP walks the whole cache
 *  every batch, and parsing coordinates out of the key made eviction the most
 *  expensive thing about it. */
interface CachedChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
  inHash: boolean;
}

const chunkCache = new Map<string, CachedChunk>();

const generateForChunk = (
  chunkKey: string,
  descriptorsByPriority: SerializedDescriptor[] // pre-sorted by priority (once per message)
): SpawnPoint[] => {
  const cached = chunkCache.get(chunkKey);
  if (cached) {
    if (!cached.inHash) {
      for (const p of cached.points) spatialHash!.insert(p);
      cached.inHash = true;
    }
    return cached.points;
  }

  const sep = chunkKey.indexOf("_");
  const cx = Number(chunkKey.slice(0, sep));
  const cz = Number(chunkKey.slice(sep + 1));
  const chunkMinX = cx * SPAWN_CHUNK_SIZE;
  const chunkMinZ = cz * SPAWN_CHUNK_SIZE;

  const chunkPoints: SpawnPoint[] = [];

  // Fetched ONCE per chunk (getFlattenPoints returns every descriptor's points)
  // and bucketed by descId; consumption order keeps spatial-hash insertion
  // byte-identical to calling the engine per descriptor.
  let flattenByDesc: Map<string, FlattenPoint[]> | null = null;

  for (const desc of descriptorsByPriority) {
    // flattenGround actors: points come from the flatten engine (the same function
    // the terrain pads under) and still enter the hash so OTHER descriptors space
    // against them.
    if (desc.flattenGround) {
      if (flattenByDesc === null) {
        flattenByDesc = new Map();
        for (const p of getFlattenPoints(
          chunkMinX,
          chunkMinZ,
          chunkMinX + SPAWN_CHUNK_SIZE,
          chunkMinZ + SPAWN_CHUNK_SIZE
        )) {
          let arr = flattenByDesc.get(p.descId);
          if (!arr) {
            arr = [];
            flattenByDesc.set(p.descId, arr);
          }
          arr.push(p);
        }
      }
      const descPoints = flattenByDesc.get(desc.id);
      if (descPoints) {
        for (const p of descPoints) {
          const point: SpawnPoint = {
            x: p.x,
            z: p.z,
            height: p.y,
            biomeId: p.biomeId,
            descriptorId: desc.id,
          };
          spatialHash!.insert(point);
          chunkPoints.push(point);
        }
      }
      continue;
    }

    if (desc.density <= 0) continue;

    const cellSize = densityCellSize(desc.density);
    const [startCellX, endCellX] = densityCellRange(chunkMinX, chunkMinX + SPAWN_CHUNK_SIZE, cellSize);
    const [startCellZ, endCellZ] = densityCellRange(chunkMinZ, chunkMinZ + SPAWN_CHUNK_SIZE, cellSize);
    const probability = densityProbability(desc.density, cellSize);

    for (let gx = startCellX; gx <= endCellX; gx++) {
      for (let gz = startCellZ; gz <= endCellZ; gz++) {
        const roll = rollDensityCell(desc.id, gx, gz, cellSize, probability, desc.clustering);
        if (!roll) continue;
        const { x, z } = roll;

        if (
          x < chunkMinX ||
          x >= chunkMinX + SPAWN_CHUNK_SIZE ||
          z < chunkMinZ ||
          z >= chunkMinZ + SPAWN_CHUNK_SIZE
        ) {
          continue;
        }

        const vd = computeVertexData(x, z);

        if (!passesPlacementFilters(vd, desc)) continue;

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

  chunkCache.set(chunkKey, {
    centerX: chunkMinX + SPAWN_CHUNK_SIZE / 2,
    centerZ: chunkMinZ + SPAWN_CHUNK_SIZE / 2,
    points: chunkPoints,
    inHash: true,
  });
  return chunkPoints;
};

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    spatialHash = new SpatialHash(e.data.maxFootprint);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "GENERATE_SPAWNS") {
    if (!initialized) {
      (self as any).postMessage({ type: "SPAWNS_RESULT", id: e.data.id, points: [], done: [] });
      return;
    }

    // TIME-budgeted: per-chunk cost varies >10× with terrain, so any fixed count is
    // wrong somewhere. Keys arrive nearest-first; leftovers are re-requested next
    // batch against the CURRENT camera position.
    const { id, chunkKeys, descriptors, budgetMs } = e.data;
    const deadline = performance.now() + budgetMs;

    // Lowest priority first (rarest placed first).
    const descriptorsByPriority = ([...descriptors] as SerializedDescriptor[]).sort(
      (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
    );

    const allPoints: SpawnPoint[] = [];
    const done: string[] = [];

    for (const key of chunkKeys) {
      const points = generateForChunk(key, descriptorsByPriority);
      for (let i = 0; i < points.length; i++) allPoints.push(points[i]);
      done.push(key);
      // Checked AFTER the first chunk so one over-budget chunk still makes progress.
      if (performance.now() >= deadline) break;
    }

    (self as any).postMessage({ type: "SPAWNS_RESULT", id, points: allPoints, done });
    return;
  }

  if (type === "CLEANUP") {
    const { playerX, playerZ, cleanupRadius } = e.data;
    const cleanupRadiusSq = cleanupRadius * cleanupRadius;

    // Coordinates live on the entry — no key parsing, just a distance test.
    chunkCache.forEach((entry, key) => {
      const dx = playerX - entry.centerX;
      const dz = playerZ - entry.centerZ;
      if (dx * dx + dz * dz <= cleanupRadiusSq) return;

      // Evict from the hash too: stale copies block their own deterministic
      // regeneration (every candidate lands on its old copy and fails spacing).
      if (entry.inHash) {
        for (const p of entry.points) spatialHash!.remove(p);
        entry.inHash = false;
      }
      chunkCache.delete(key);
    });
    return;
  }

  if (type === "UPDATE_FOOTPRINT") {
    spatialHash = new SpatialHash(e.data.maxFootprint);
    chunkCache.forEach((entry) => {
      entry.inHash = false;
    });
    return;
  }
};
